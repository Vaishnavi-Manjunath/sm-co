import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.smand.app',
  appName: 'Sri Murugan Co',
  webDir: 'dist/app',

  // Load the live server instead of a local bundle.
  // This means every deployment to smand.co automatically reaches all app users
  // with no APK update required.
  server: {
    url: 'https://smand.co/app/',
    cleartext: false,
    androidScheme: 'https',
  },

  android: {
    buildOptions: {
      keystorePath: undefined,   // filled in when signing for Play Store
      keystoreAlias: undefined,
    },
  },
};

export default config;
