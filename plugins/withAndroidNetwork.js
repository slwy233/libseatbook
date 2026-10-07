// Preserve access to the existing HTTP OCR/schedule service when prebuilding Android.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = config => withAndroidManifest(config, result => {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(result.modResults);
  application.$['android:usesCleartextTraffic'] = 'true';
  return result;
});
