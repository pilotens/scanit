const {
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');

const DEFAULT_READ_DESCRIPTION =
  'ScanIt läser puls, HRV, syremättnad, handledstemperatur och EKG från Apple Health för att skapa en personlig forskningsöversikt.';

module.exports = function withScanItHealthKit(config, options = {}) {
  config = withEntitlementsPlist(config, (configWithEntitlements) => {
    configWithEntitlements.modResults['com.apple.developer.healthkit'] = true;
    return configWithEntitlements;
  });

  config = withInfoPlist(config, (configWithInfoPlist) => {
    configWithInfoPlist.modResults.NSHealthShareUsageDescription =
      options.healthSharePermission || DEFAULT_READ_DESCRIPTION;
    return configWithInfoPlist;
  });

  return config;
};
