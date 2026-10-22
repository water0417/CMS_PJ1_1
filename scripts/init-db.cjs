const { execFileSync } = require('node:child_process');
const command =
  "try { rs.status().ok } catch(e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]}) }";
execFileSync(
  'docker',
  ['compose', 'exec', '-T', 'mongo', 'mongosh', '--quiet', '--eval', command],
  { stdio: 'inherit' },
);
