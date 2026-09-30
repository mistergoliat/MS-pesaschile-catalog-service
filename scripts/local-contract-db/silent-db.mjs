// Accepts TCP connections on 33399 and never answers (a hung database under catalog-service).
import { createServer } from 'node:net';
const sockets = [];
createServer((s) => { sockets.push(s); s.on('error', () => {}); }).listen(33399, '127.0.0.1', () => console.log('silent db on 33399'));
