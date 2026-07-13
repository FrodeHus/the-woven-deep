const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const health = await fetch(`${baseUrl}/api/health`);
if (!health.ok) throw new Error(`health returned ${health.status}`);
const body = await health.json();
if (body.status !== 'ok' || !/^[a-f0-9]{64}$/.test(body.contentHash) || body.entries < 2) {
  throw new Error(`invalid health payload: ${JSON.stringify(body)}`);
}
const page = await fetch(baseUrl);
if (!page.ok || !(await page.text()).includes('<div id="root">')) {
  throw new Error('web client was not served');
}
process.stdout.write(`ok ${body.contentHash} ${body.entries} entries\n`);
