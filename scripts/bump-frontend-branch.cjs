const fs = require('node:fs');
(async () => {
  const base = 'http://127.0.0.1:3102/api';
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'branch_ui', password: 'TestPass123!' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const fixtures = JSON.parse(fs.readFileSync('test-results/frontend-branch-fixtures.json'));
  const url = base + '/surveys/' + fixtures.legacy.id;
  const s = await (await fetch(url, { headers: { Cookie: cookie } })).json();
  const r = await fetch(url + '/draft', {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition: s.draft, revision: s.revision }),
  });
  console.log(r.status);
})();
