const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
  cwd: root, env: { ...process.env, CI: '1', EXPO_OFFLINE: '1' }, encoding: 'utf8',
});
if (result.status !== 0) throw new Error(result.stderr || 'Expo config introspection failed');
const config = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
const manifest = config._internal.modResults.android.manifest.manifest;
const permissions = (manifest['uses-permission'] || []).filter(item => item.$['tools:node'] !== 'remove').map(item => item.$['android:name']);
if (manifest.application[0].$['android:usesCleartextTraffic'] !== 'true') throw new Error('Missing cleartext HTTP configuration');
for (const suffix of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'VIBRATE', 'SCHEDULE_EXACT_ALARM', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK']) {
  if (permissions.some(permission => permission.endsWith(suffix))) throw new Error('Unused permission remains: ' + suffix);
}
fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
fs.writeFileSync(path.join(root, 'outputs/expo-introspect.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Android config verified: cleartext HTTP enabled; unused permissions absent or marked for removal.');
console.log('Active permission declarations: ' + permissions.join(', '));
