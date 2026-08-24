const fs = require("fs");
const content = fs.readFileSync("pdf_text.txt", "utf8");
const lines = content.split("\n");
const interesting = [];
for (const line of lines) {
  if (/[\u4e00-\u9fff]/.test(line) || /size|resolution|width|height|model|parameter|api|request|response|url|format|image|video|生成|图像|模型|参数|请求|响应|格式|分辨率|尺寸|最小|最大|支持|像素|3686400/i.test(line)) {
    const cleaned = line.replace(/[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffefa-zA-Z0-9\s\.\,\;\:\-\(\)\[\]\{\}\/\\@#\$%\^&\*\+\=\|_~\x60\x27\x22\x3c\x3e\x21\x3f]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length > 10) interesting.push(cleaned);
  }
}
console.log(interesting.slice(0, 100).join("\n"));
