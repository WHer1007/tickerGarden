import fs from 'node:fs';
import ts from 'typescript';
const paths=['../src/controllers/create.ts','../src/controllers/trade.ts','../src/app.ts'];
export const controllerSources=paths.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/\bctx\./g,''));
/** Inspect the implementation body, never the application's lazy facade. */
export function controllerFunction(name:string):string{
 for(const source of controllerSources){const tree=ts.createSourceFile('controller.ts',source,ts.ScriptTarget.Latest,true);let result:string|undefined;
  const walk=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name){result=node.getText(tree);return;}ts.forEachChild(node,walk);};walk(tree);if(result)return result;
 }
 throw Error(`Missing controller implementation: ${name}`);
}
