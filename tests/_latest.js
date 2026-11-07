// prototype/ の最新版(番号が最大の brain_dojo_v*.html)を返す。版を足してもテストを書き換えなくてよいようにする。
const fs = require('fs'), path = require('path');
const dir = path.resolve(__dirname, '..', 'prototype');
const num = n => parseInt(n.match(/_v(\d+)\.html$/)[1], 10);
const name = fs.readdirSync(dir).filter(n => /^brain_dojo_v\d+\.html$/.test(n)).sort((a, b) => num(a) - num(b)).pop();
module.exports = { name, file: path.join(dir, name) };
