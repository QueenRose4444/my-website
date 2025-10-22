const fs = require('fs');
const path = require('path');

// Create output directory
const outputDir = 'public';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Copy everything recursively
function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(child => {
            copyRecursive(path.join(src, child), path.join(dest, child));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

// Get all items in root
fs.readdirSync('.').forEach(item => {
    if (item !== 'public' && item !== 'node_modules' && item !== '.git' && item !== 'build.js' && item !== 'package.json') {
        copyRecursive(item, path.join(outputDir, item));
    }
});

// Rename all HTML files to index.html
function renameHtmlFiles(dir) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
            renameHtmlFiles(fullPath);
        } else if (file.endsWith('.html') && file !== 'index.html') {
            const newPath = path.join(dir, 'index.html');
            fs.renameSync(fullPath, newPath);
            console.log(`Renamed: ${fullPath} -> ${newPath}`);
        }
    });
}

renameHtmlFiles(outputDir);
console.log('Build complete!');