// Mapbox Navigation on iOS only. The package's own config plugin also rewires
// the Android build (Mapbox Maven with a secret token); Android does not use
// it, so only the two iOS steps are repeated here:
//   1. the public token in Info.plist, and the audio background mode so spoken
//      directions keep playing with the screen off;
//   2. the Podfile hook that adds the Navigation SDK as a Swift package.
const path = require('node:path');
const { promises: fs } = require('node:fs');
const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const PKG = '@atomiqlab/react-native-mapbox-navigation';

module.exports = function withMapboxNavIos(config) {
  config = withInfoPlist(config, (cfg) => {
    const token = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || (cfg.extra && cfg.extra.mapboxPublicToken) || '';
    if (token) cfg.modResults.MBXAccessToken = token;
    const modes = new Set(cfg.modResults.UIBackgroundModes || []);
    modes.add('location');
    modes.add('audio');
    cfg.modResults.UIBackgroundModes = Array.from(modes);
    return cfg;
  });

  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const pkgJson = require.resolve(`${PKG}/package.json`, { paths: [cfg.modRequest.projectRoot] });
      const helper = path.join(path.dirname(pkgJson), 'ios', 'spm.rb');
      let rel = path.relative(path.dirname(podfile), helper);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      let src = await fs.readFile(podfile, 'utf8');
      src = mergeContents({
        tag: 'rangepilot-mapbox-nav-require',
        src,
        newSrc: `require_relative '${rel}'`,
        anchor: /target .+ do/,
        offset: 0,
        comment: '#',
      }).contents;
      const hook = mergeContents({
        tag: 'rangepilot-mapbox-nav-post_install',
        src,
        newSrc: '    $ExpoMapboxNavigation.post_install(installer)',
        anchor: /^\s*post_install do \|installer\|/m,
        offset: 1,
        comment: '#',
      });
      if (!hook.didMerge) throw new Error('withMapboxNavIos: no post_install block in the Podfile');
      await fs.writeFile(podfile, hook.contents, 'utf8');
      return cfg;
    },
  ]);
};
