#!/usr/bin/env python3
"""Build and sign the "sbl.cx text" iOS Shortcut.

Usage: scripts/make-shortcut.py <host> <api-token> <out.shortcut>

The shortcut asks for a line of text, posts it to the code as a one-hour
temporary message through POST /_/api/send with the bearer token, and confirms
with a notification. Signing needs macOS (`shortcuts sign`); the signed file
imports straight into Shortcuts on the Mac or the phone, and holds the token,
so keep it out of git.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid

host, token, out = sys.argv[1:4]
ask = str(uuid.uuid4()).upper()


def text(value):
    return {'Value': {'string': value, 'attachmentsByRange': {}},
            'WFSerializationType': 'WFTextTokenString'}


def provided_input():
    """The Ask action's output, as a token inside a text field."""
    return {'Value': {'string': '￼', 'attachmentsByRange': {
        '{0, 1}': {'OutputName': 'Provided Input', 'OutputUUID': ask, 'Type': 'ActionOutput'}}},
        'WFSerializationType': 'WFTextTokenString'}


def item(key, value, kind=0):  # kind: 0 text, 3 number
    return {'WFItemType': kind, 'WFKey': text(key), 'WFValue': value}


def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': items},
            'WFSerializationType': 'WFDictionaryFieldValue'}


actions = [
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.ask',
     'WFWorkflowActionParameters': {
         'UUID': ask,
         'WFAskActionPrompt': 'What should the code say?',
         'WFInputType': 'Text',
         'WFAllowsMultilineText': True,
     }},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
     'WFWorkflowActionParameters': {
         'UUID': str(uuid.uuid4()).upper(),
         'WFURL': f'https://{host}/_/api/send',
         'WFHTTPMethod': 'POST',
         'ShowHeaders': True,
         'WFHTTPHeaders': dictionary([item('Authorization', text(f'Bearer {token}'))]),
         'WFHTTPBodyType': 'JSON',
         'WFJSONValues': dictionary([
             item('slot', text('temp')),
             item('minutes', text('60'), 3),
             item('text', provided_input()),
         ]),
     }},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
     'WFWorkflowActionParameters': {
         'WFNotificationActionTitle': text(f'{host} for the next hour'),
         'WFNotificationActionBody': provided_input(),
         'WFNotificationActionSound': False,
     }},
]

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
print(out)
