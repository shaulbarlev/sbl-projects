#!/usr/bin/env python3
"""Build and sign the "sbl.cx" iOS Shortcut.

Usage: scripts/make-shortcut.py <host> <api-token> <out.shortcut>

One Shortcut, one menu, for the Action Button:

    Text · Link · Scan a QR · Take a photo · Pick a photo · GIF feed ·
    Bookmark · Extend · End now · What's live · More…

Everything that points the code somewhere asks how long for (15m / 1h / 4h /
24h / custom minutes) and then makes one request: POST /_/api/send with the
flat body, or POST /_/api/upload?slot=temp for a photo. Photos are converted to
JPEG with metadata stripped first, because the file is public to whoever
scans. A QR is read with the camera and sent as `value`, so a link stays a
link and anything else becomes a message. Every request ends in a
notification carrying the server's one-line `summary`.

More… holds Set main (text or link, behind a confirm) and Arm / Disarm.

Signing needs macOS (`shortcuts sign`). The signed file imports straight into
Shortcuts on the Mac or the phone, and holds the token, so keep it out of git.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid

host, token, out = sys.argv[1:4]
API = f'https://{host}/_/api/'

actions = []


def new_uuid():
    return str(uuid.uuid4()).upper()


def add(identifier, **params):
    params.setdefault('UUID', new_uuid())
    actions.append({'WFWorkflowActionIdentifier': f'is.workflow.actions.{identifier}',
                    'WFWorkflowActionParameters': params})
    return params['UUID']


# --- value encodings ---------------------------------------------------------

def text(*parts):
    """A text field. Parts are literal strings or ('var', name) tokens."""
    string, attachments = '', {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            attachments[f'{{{len(string)}, 1}}'] = {'Type': 'Variable', 'VariableName': part[1]}
            string += '￼'
    return {'Value': {'string': string, 'attachmentsByRange': attachments},
            'WFSerializationType': 'WFTextTokenString'}


def var(name):
    return ('var', name)


def attach_var(name):
    return {'Value': {'Type': 'Variable', 'VariableName': name},
            'WFSerializationType': 'WFTextTokenAttachment'}


def attach_output(action_uuid, output_name):
    return {'Value': {'Type': 'ActionOutput', 'OutputUUID': action_uuid, 'OutputName': output_name},
            'WFSerializationType': 'WFTextTokenAttachment'}


def item(key, value, kind=0):  # 0 text, 3 number
    return {'WFItemType': kind, 'WFKey': text(key), 'WFValue': value}


def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': items},
            'WFSerializationType': 'WFDictionaryFieldValue'}


# --- building blocks ---------------------------------------------------------

def set_var(name):
    """Store the previous action's output under a name."""
    add('setvariable', WFVariableName=name)


def literal(value):
    add('gettext', WFTextActionText=text(value))


def ask(prompt, kind='Text', default=None):
    params = {'WFAskActionPrompt': prompt, 'WFInputType': kind, 'WFAllowsMultilineText': True}
    if default is not None:
        params['WFAskActionDefaultAnswer'] = default
    add('ask', **params)


def menu(prompt, cases):
    """Choose from Menu. cases: [(title, emit_body), ...]"""
    group = new_uuid()
    add('choosefrommenu', GroupingIdentifier=group, WFControlFlowMode=0,
        WFMenuPrompt=prompt, WFMenuItems=[title for title, _ in cases])
    for title, body in cases:
        add('choosefrommenu', GroupingIdentifier=group, WFControlFlowMode=1, WFMenuItemTitle=title)
        body()
    add('choosefrommenu', GroupingIdentifier=group, WFControlFlowMode=2)


def duration(prompt='For how long?'):
    """Sets the `minutes` variable."""
    def preset(n):
        return lambda: (literal(str(n)), set_var('minutes'))

    def custom():
        ask('Minutes', 'Number', default='60')
        set_var('minutes')

    menu(prompt, [('15 min', preset(15)), ('1 hour', preset(60)), ('4 hours', preset(240)),
                  ('24 hours', preset(1440)), ('Custom…', custom)])


def request(method, path, json_items=None, file_var=None, url=None):
    headers = [item('Authorization', text(f'Bearer {token}'))]
    params = {'WFURL': url or f'{API}{path}', 'WFHTTPMethod': method,
              'ShowHeaders': True}
    if json_items is not None:
        params['WFHTTPBodyType'] = 'JSON'
        params['WFJSONValues'] = dictionary(json_items)
    if file_var:
        headers.append(item('Content-Type', text('image/jpeg')))
        params['WFHTTPBodyType'] = 'File'
        params['WFRequestVariable'] = attach_var(file_var)
    params['WFHTTPHeaders'] = dictionary(headers)
    return add('downloadurl', **params)


def notify(response_uuid):
    """Show the server's one-line summary of what a scan now gets."""
    value = add('getvalueforkey', WFGetDictionaryValueType='Value', WFDictionaryKey='summary',
                WFInput=attach_output(response_uuid, 'Contents of URL'))
    add('notification', WFNotificationActionTitle=text(host), WFNotificationActionSound=False,
        WFNotificationActionBody={'Value': {'string': '￼', 'attachmentsByRange': {
            '{0, 1}': {'Type': 'ActionOutput', 'OutputUUID': value, 'OutputName': 'Dictionary Value'}}},
            'WFSerializationType': 'WFTextTokenString'})


def send(field, slot='temp', ask_duration=True):
    """The shared tail: optional duration, one POST /send, notification."""
    if ask_duration:
        duration()
    items = [item('slot', text(slot)), item(field, text(var('value')))]
    if ask_duration:
        items.append(item('minutes', text(var('minutes')), 3))
    notify(request('POST', 'send', items))


def confirm_main():
    add('alert', WFAlertActionTitle=text('Set main?'),
        WFAlertActionMessage=text('The code will point at: ', var('value'), '\n\nThis persists until you change it.'),
        WFAlertActionCancelButtonShown=True)


# --- the menu ----------------------------------------------------------------

def text_case():
    ask('What should the code say?')
    set_var('value')
    send('text')


def link_case():
    ask('Where should the code point?', 'URL')
    set_var('value')
    send('value')


def scan_case():
    add('scanbarcode')
    set_var('value')
    send('value')


def photo_case(source):
    if source == 'camera':
        add('takephoto', WFCameraCaptureDevice='Back', WFPhotoCount=1, WFTakePhotoShowPreview=True)
    else:
        add('selectphoto', WFSelectMultiple=False)
    # JPEG with metadata stripped: the file is public to whoever scans, and
    # a library photo otherwise carries where it was taken.
    add('image.convert', WFImageFormat='JPEG', WFImageCompressionQuality=0.8, WFImagePreserveMetadata=False)
    set_var('photo')
    duration()
    notify(request('POST', 'upload', file_var='photo',
                   url=text(f'{API}upload?slot=temp&minutes=', var('minutes'))))


def gif_case():
    ask('Search Giphy for…')
    set_var('value')
    send('query')


def bookmark_case():
    state = request('GET', 'state')
    labels = add('getvalueforkey', WFGetDictionaryValueType='Value', WFDictionaryKey='bookmarkLabels',
                 WFInput=attach_output(state, 'Contents of URL'))
    add('choosefromlist', WFChooseFromListPrompt='Which bookmark?',
        WFInput=attach_output(labels, 'Dictionary Value'))
    set_var('value')
    send('bookmark')


def extend_case():
    duration('Extend by')
    notify(request('POST', 'temp/extend', [item('minutes', text(var('minutes')), 3)]))


def end_case():
    notify(request('DELETE', 'temp'))


def live_case():
    notify(request('GET', 'state'))


def more_case():
    def main_text():
        ask('What should the code say?')
        set_var('value')
        confirm_main()
        send('text', slot='main', ask_duration=False)

    def main_link():
        ask('Where should the code point?', 'URL')
        set_var('value')
        confirm_main()
        send('value', slot='main', ask_duration=False)

    def arm():
        duration('Armed for')
        notify(request('POST', 'sequence/arm', [item('minutes', text(var('minutes')), 3)]))

    def disarm():
        notify(request('DELETE', 'sequence/arm'))

    menu('More', [('Set main: text', main_text), ('Set main: link', main_link),
                  ('Arm sequence', arm), ('Disarm sequence', disarm)])


menu(host, [
    ('Text', text_case),
    ('Link', link_case),
    ('Scan a QR', scan_case),
    ('Take a photo', lambda: photo_case('camera')),
    ('Pick a photo', lambda: photo_case('library')),
    ('GIF feed', gif_case),
    ('Bookmark', bookmark_case),
    ('Extend', extend_case),
    ('End now', end_case),
    ("What's live", live_case),
    ('More…', more_case),
])

workflow = {
    'WFWorkflowClientVersion': '2607.0.3',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowImportQuestions': [],
    'WFWorkflowTypes': [],
    'WFWorkflowInputContentItemClasses': [],
    'WFWorkflowHasShortcutInputVariables': False,
    'WFWorkflowActions': actions,
}

with tempfile.NamedTemporaryFile(suffix='.shortcut', delete=False) as unsigned:
    plistlib.dump(workflow, unsigned, fmt=plistlib.FMT_XML)
subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', unsigned.name, '--output', out], check=True)
print(f'{out}: {len(actions)} actions')
