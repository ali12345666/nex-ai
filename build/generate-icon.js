// Run this script to generate a placeholder icon:
// node build/generate-icon.js
// 
// For production, replace build/icon.png with your actual 256x256 or 512x512 icon
// Then run: npx electron-builder icon --input=build/icon.png --output=build/icon.ico

const fs = require('fs');
const path = require('path');

// Create a minimal valid PNG file (1x1 purple pixel as placeholder)
// This is a base64-encoded 16x16 purple PNG
const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC41ZYUyZQAAABFJREFUOE9j/P///38GKgYR3Rz9Bwj5L5CfDeU2AAAAAElFTkSuQmCC',
  'base64'
);

const buildDir = path.join(__dirname);
const iconPath = path.join(buildDir, 'icon.png');

if (!fs.existsSync(iconPath)) {
  fs.writeFileSync(iconPath, placeholderPng);
  console.log('✅ Placeholder icon.png created at build/icon.png');
  console.log('');
  console.log('📌 To use your own icon:');
  console.log('   1. Replace build/icon.png with your 256x256+ PNG image');
  console.log('   2. Run: npx electron-builder icon --input=build/icon.png');
  console.log('   This will generate build/icon.ico for Windows');
  console.log('');
} else {
  console.log('ℹ️  build/icon.png already exists');
}
