import http from 'node:http';

export const fixtureHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tabloom playground</title>
<style>
body{font:18px system-ui;margin:0;background:#eef3ef;color:#173e32}main{max-width:800px;margin:70px auto;padding:40px;background:white;border-radius:24px}h1{font-size:48px;margin:8px 0}p{line-height:1.6}label{display:block;font-weight:600;margin-bottom:10px}input,button{font:inherit;border-radius:10px;padding:12px 18px}input{border:1px solid #b9c9c0}button{background:#175c48;color:white;border:0;cursor:pointer}#result{min-height:30px;padding:20px;background:#e5f5ec;border-radius:12px}a{color:#175c48}.spacer{height:1000px}footer{padding:40px;background:#d2e8db}small{letter-spacing:3px;text-transform:uppercase}
</style></head><body><main>
<small>Tabloom · local playground</small><h1>Your browser, on your terms.</h1>
<p>This page is a local fixture for testing an agent's browser controls. Nothing entered here leaves this machine.</p>
<form id="greeting"><label for="name">Your name</label><input id="name" name="name" placeholder="Type a name" autocomplete="off"><button id="greet" type="submit">Say hello</button></form>
<p id="result" role="status">Ready for your agent.</p>
<button id="counter" type="button">Count: 0</button>
<div id="shadow-host"></div>
<p><a id="next" href="/next">Visit the next page</a></p>
<div class="spacer"></div><footer id="bottom">You reached the bottom.</footer>
</main><script>
document.querySelector('#greeting').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#result').textContent='Hello, '+document.querySelector('#name').value+'!';});
let count=0;document.querySelector('#counter').addEventListener('click',event=>{event.target.textContent='Count: '+(++count);});
const outer=document.querySelector('#shadow-host').attachShadow({mode:'open'});
outer.innerHTML='<section id="shadow-panel"><label for="shadow-input">Shadow message</label><input id="shadow-input"><button id="shadow-button">Send shadow</button><div id="nested-host"></div><p id="shadow-result">Shadow ready.</p></section>';
outer.querySelector('#shadow-button').addEventListener('click',()=>{outer.querySelector('#shadow-result').textContent='Shadow: '+outer.querySelector('#shadow-input').value;});
const nested=outer.querySelector('#nested-host').attachShadow({mode:'open'});
nested.innerHTML='<button id="nested-button">Nested count: 0</button>';
let nestedCount=0;nested.querySelector('#nested-button').addEventListener('click',event=>{event.target.textContent='Nested count: '+(++nestedCount);});
</script></body></html>`;

export async function startFixture() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url === '/next'
      ? '<!doctype html><html><head><title>Next page</title></head><body><h1 id="destination">Navigation complete</h1><a href="/">Back to playground</a></body></html>'
      : fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
