// Expo's Metro config detects the pnpm workspace and watches packages/shared and packages/api-client.
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
