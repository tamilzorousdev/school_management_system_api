const fs=require("fs");const path=require("path");const {chapterXml}=require("./blocks.js");
const [,,spec,dir,before]=process.argv;const ch=JSON.parse(fs.readFileSync(spec,"utf8")).chapter;
const p=path.join(dir,"word","document.xml");let xml=fs.readFileSync(p,"utf8");
const re=/<w:p[ >][\s\S]*?<\/w:p>/g;let m,pos=-1;
while((m=re.exec(xml))){if(/<w:pStyle w:val="Heading1"/.test(m[0])){const t=[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(x=>x[1]).join("");if(t.startsWith(before)){pos=m.index;break}}}
if(pos<0)throw new Error("heading not found: "+before);
xml=xml.slice(0,pos)+chapterXml(ch)+xml.slice(pos);fs.writeFileSync(p,xml);console.log("chapter inserted at",pos);
