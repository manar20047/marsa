// Inlines the web app into one self-contained HTML file (dist/marsa.html) for static hosting / artifact.
const fs = require('fs'), path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
let html = R('web/index.html').replace(/<!--PWA-->[\s\S]*?<!--\/PWA-->/, '');
html = html.replace(/<!--STYLE-->[\s\S]*?<!--\/STYLE-->/, () => '<style>\n' + R('web/styles.css') + '\n</style>');
const js = ['shared/core.js', 'shared/service.js', 'web/i18n.js', 'web/map.js', 'web/export.js', 'web/app.js'].map(f => '<script>\n/* ' + f + ' */\n' + R(f).replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n');
html = html.replace(/<!--SCRIPTS-->[\s\S]*?<!--\/SCRIPTS-->/, () => js);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/marsa.html'), html);
console.log('dist/marsa.html', (html.length / 1024).toFixed(0) + ' KB');
