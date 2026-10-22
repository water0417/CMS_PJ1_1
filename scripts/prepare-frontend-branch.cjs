const fs = require('node:fs');
const mongoose = require('mongoose');
(async () => {
  const base = 'http://127.0.0.1:3102/api';
  let cookie = '';
  async function request(url, method = 'GET', body) {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw Error(JSON.stringify(data));
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return data;
  }
  await request('/auth/register', 'POST', { username: 'branch_ui', password: 'TestPass123!' });
  await request('/auth/login', 'POST', { username: 'branch_ui', password: 'TestPass123!' });
  const sample = JSON.parse(fs.readFileSync('docs/examples/branch-routing.json', 'utf8'));
  sample.allowRepeatSubmissions = true;
  const result = {};
  for (const name of ['editor', 'published', 'legacy', 'invalid']) {
    let s = await request('/surveys', 'POST', { title: '分支验收 ' + name });
    const d = structuredClone(sample);
    d.title = '分支验收 ' + name;
    s = await request('/surveys/' + s._id + '/draft', 'PUT', {
      definition: d,
      revision: s.revision,
    });
    if (name === 'published')
      s = await request('/surveys/' + s._id + '/publish', 'POST', {
        revision: s.revision,
        deadlineAt: null,
      });
    result[name] = { id: s._id, publicId: s.publicId };
  }
  await mongoose.connect(
    'mongodb://127.0.0.1:27018/survey_studio_ui_branch_1792650000?replicaSet=rs0&directConnection=true',
  );
  for (const name of ['legacy', 'invalid'])
    await mongoose.connection.db
      .collection('surveys')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(result[name].id) },
        { $unset: { 'draft.routingMode': '' } },
      );
  await mongoose.connection.db
    .collection('surveys')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(result.invalid.id) },
      {
        $set: {
          'draft.questions': [
            {
              ...sample.questions[1],
              id: 'q2',
              jumpRules: [{ id: 'loop', operator: 'eq', value: 'a', target: 'q2' }],
            },
          ],
        },
      },
    );
  await mongoose.disconnect();
  fs.writeFileSync('test-results/frontend-branch-fixtures.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
