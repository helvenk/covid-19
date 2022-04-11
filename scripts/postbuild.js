const fs = require('fs-extra');
const path = require('path');
const pkgJSON = require('../package.json');

const output = path.join(__dirname, '../lib');
const dist = path.join(__dirname, '../dist');

fs.emptyDirSync(dist);

fs.copySync(output, dist);

pkgJSON.scripts.start = 'node server.js';

fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(pkgJSON, null, 2));

const server = fs.readFileSync(path.join(dist, 'server.js'), 'utf8');
const update = server.replace(
  '"use strict";',
  `"use strict";
const { spawnSync } = require('child_process');
spawnSync('npx', ['yarn'], { shell: true, stdio: 'inherit' });`,
);
fs.writeFileSync(path.join(dist, 'server.js'), update);

fs.removeSync(path.join(__dirname, '../lib'));
fs.removeSync(path.join(__dirname, '../es'));
