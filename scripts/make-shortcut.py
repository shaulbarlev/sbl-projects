#!/usr/bin/env python3
"""Build and sign the "sbl.cx" iOS Shortcut.

Usage: scripts/make-shortcut.py <host> <api-token> <out.shortcut> [--test]

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

Every action input is wired explicitly to the producing action's output. The
runtime does not hand a previous output to an action whose input is absent —
Set Variable in particular quietly stores nothing — so nothing here relies on
the implicit flow.

--test builds a non-interactive variant instead: convert the Shortcut's input
image, upload it for two minutes, notify. `shortcuts run <name> -i photo.jpg`
on a Mac exercises the same request plumbing the phone uses.

Signing needs macOS (`shortcuts sign`). The signed file imports straight into
Shortcuts on the Mac or the phone, and holds the token, so keep it out of git.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid

host, token, out = sys.argv[1:4]
TEST = '--test' in sys.argv
API = f'https://{host}/_/api/' if not host.startswith('http') else f'{host}/_/api/'

actions = []


def new_uuid():
    return str(uuid.uuid4()).upper()


def add(identifier, output_name=None, **params):
    """Append an action. Returns (uuid, output name) for wiring its output."""
    params.setdefault('UUID', new_uuid())
    actions.append({'WFWorkflowActionIdentifier': f'is.workflow.actions.{identifier}',
                    'WFWorkflowActionParameters': params})
    return params['UUID'], output_name


# --- value encodings ---------------------------------------------------------

def token_of(ref):
    """An attachment token for a variable name or an (uuid, output) pair."""
    if isinstance(ref, str):
        return {'Type': 'Variable', 'VariableName': ref}
    return {'Type': 'ActionOutput', 'OutputUUID': ref[0], 'OutputName': ref[1]}


def text(*parts):
    """A text field. Parts are literal strings or refs (variable name / output)."""
    string, attachments = '', {}
    for part in parts:
        if isinstance(part, str) and not part.startswith('$'):
            string += part
        else:
            ref = part[1:] if isinstance(part, str) else part
            attachments[f'{{{len(string)}, 1}}'] = token_of(ref)
            string += '￼'
    return {'Value': {'string': string, 'attachmentsByRange': attachments},
            'WFSerializationType': 'WFTextTokenString'}


def attach(ref):
    return {'Value': token_of(ref), 'WFSerializationType': 'WFTextTokenAttachment'}


def item(key, value, kind=0):  # 0 text, 3 number
    return {'WFItemType': kind, 'WFKey': text(key), 'WFValue': value}


def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': items},
            'WFSerializationType': 'WFDictionaryFieldValue'}


# --- building blocks ---------------------------------------------------------

def set_var(name, src):
    add('setvariable', WFVariableName=name, WFInput=attach(src))


def literal(value):
    return add('gettext', 'Text', WFTextActionText=text(value))


def ask(prompt, kind='Text', default=None):
    params = {'WFAskActionPrompt': prompt, 'WFInputType': kind, 'WFAllowsMultilineText': True}
    if default is not None:
        params['WFAskActionDefaultAnswer'] = default
    return add('ask', 'Provided Input', **params)


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
        return lambda: set_var('minutes', literal(str(n)))

    def custom():
        set_var('minutes', ask('Minutes', 'Number', default='60'))

    menu(prompt, [('15 min', preset(15)), ('1 hour', preset(60)), ('4 hours', preset(240)),
                  ('24 hours', preset(1440)), ('Custom…', custom)])


def request(method, path, json_items=None, file_ref=None, url=None):
    headers = [item('Authorization', text(f'Bearer {token}'))]
    params = {'WFURL': url or f'{API}{path}', 'WFHTTPMethod': method, 'ShowHeaders': True}
    if json_items is not None:
        params['WFHTTPBodyType'] = 'JSON'
        params['WFJSONValues'] = dictionary(json_items)
    if file_ref is not None:
        headers.append(item('Content-Type', text('image/jpeg')))
        params['WFHTTPBodyType'] = 'File'
        params['WFRequestVariable'] = attach(file_ref)
    params['WFHTTPHeaders'] = dictionary(headers)
    return add('downloadurl', 'Contents of URL', **params)


def notify(response):
    """Show the server's one-line summary of what a scan now gets."""
    value = add('getvalueforkey', 'Dictionary Value', WFGetDictionaryValueType='Value',
                WFDictionaryKey='summary', WFInput=attach(response))
    add('notification', WFNotificationActionTitle=text(host), WFNotificationActionSound=False,
        WFNotificationActionBody=text(value))


def send(field, slot='temp', ask_duration=True):
    """The shared tail: optional duration, one POST /send, notification."""
    if ask_duration:
        duration()
    items = [item('slot', text(slot)), item(field, text('$value'))]
    if ask_duration:
        items.append(item('minutes', text('$minutes'), 3))
    notify(request('POST', 'send', items))


def confirm_main():
    add('alert', WFAlertActionTitle=text('Set main?'),
        WFAlertActionMessage=text('The code will point at: ', '$value', '\n\nThis persists until you change it.'),
        WFAlertActionCancelButtonShown=True)


def to_jpeg(image):
    # JPEG with metadata stripped: the file is public to whoever scans, and
    # a library photo otherwise carries where it was taken.
    return add('image.convert', 'Converted Image', WFInput=attach(image), WFImageFormat='JPEG',
               WFImageCompressionQuality=0.8, WFImagePreserveMetadata=False)


def upload(image_ref):
    notify(request('POST', 'upload', file_ref=image_ref,
                   url=text(f'{API}upload?slot=temp&minutes=', '$minutes')))


# --- the menu ----------------------------------------------------------------

def text_case():
    set_var('value', ask('What should the code say?'))
    send('text')


def link_case():
    set_var('value', ask('Where should the code point?', 'URL'))
    send('value')


def scan_case():
    set_var('value', add('scanbarcode', 'QR/Barcode'))
    send('value')


def photo_case(source):
    if source == 'camera':
        shot = add('takephoto', 'Photos', WFCameraCaptureDevice='Back', WFPhotoCount=1,
                   WFTakePhotoShowPreview=True)
    else:
        shot = add('selectphoto', 'Photos', WFSelectMultiple=False)
    image = to_jpeg(shot)
    duration()
    upload(image)


def gif_case():
    set_var('value', ask('Search Giphy for…'))
    send('query')


def bookmark_case():
    state = request('GET', 'state')
    labels = add('getvalueforkey', 'Dictionary Value', WFGetDictionaryValueType='Value',
                 WFDictionaryKey='bookmarkLabels', WFInput=attach(state))
    chosen = add('choosefromlist', 'Chosen Item', WFChooseFromListPrompt='Which bookmark?',
                 WFInput=attach(labels))
    set_var('value', chosen)
    send('bookmark')


def extend_case():
    duration('Extend by')
    notify(request('POST', 'temp/extend', [item('minutes', text('$minutes'), 3)]))


def end_case():
    notify(request('DELETE', 'temp'))


def live_case():
    notify(request('GET', 'state'))


def more_case():
    def main_text():
        set_var('value', ask('What should the code say?'))
        confirm_main()
        send('text', slot='main', ask_duration=False)

    def main_link():
        set_var('value', ask('Where should the code point?', 'URL'))
        confirm_main()
        send('value', slot='main', ask_duration=False)

    def arm():
        duration('Armed for')
        notify(request('POST', 'sequence/arm', [item('minutes', text('$minutes'), 3)]))

    def disarm():
        notify(request('DELETE', 'sequence/arm'))

    menu('More', [('Set main: text', main_text), ('Set main: link', main_link),
                  ('Arm sequence', arm), ('Disarm sequence', disarm)])


if TEST:
    # Shortcut Input is the image; no menus, no prompts.
    image = to_jpeg(('SHORTCUT_INPUT', 'Shortcut Input'))
    set_var('minutes', literal('2'))
    upload(image)
else:
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
    'WFWorkflowInputContentItemClasses': ['WFImageContentItem'] if TEST else [],
    'WFWorkflowHasShortcutInputVariables': TEST,
    'WFWorkflowActions': actions,
}

with tempfile.NamedTemporaryFile(suffix='.shortcut', delete=False) as unsigned:
    plistlib.dump(workflow, unsigned, fmt=plistlib.FMT_XML)
subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', unsigned.name, '--output', out], check=True)
print(f'{out}: {len(actions)} actions')
