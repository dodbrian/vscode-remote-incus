# Enable editor support

Remote-Incus uses proposed editor APIs to register remote connections, integrate
with Remote Explorer and forward ports. These APIs require permission for this
extension in your editor.

**Enable Support…** opens your editor's runtime arguments file and asks before
adding `dodbrian.remote-incus` to `enable-proposed-api` and saving it. Existing
settings, comments and other extension IDs are preserved. Invalid configuration
is left for you to correct. Save or discard any existing unsaved edits first.

You can instead run **Preferences: Configure Runtime Arguments** and add:

```json
"enable-proposed-api": ["dodbrian.remote-incus"]
```

If the array already contains other extension IDs, append this ID to that array.

Any usage-data notice at the bottom of the built-in Welcome page belongs to the
editor. Remote-Incus does not send usage telemetry. Your editor controls its own
privacy settings.
