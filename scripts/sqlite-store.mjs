import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync,readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same prepared SQL and atomic batches as D1; one Node service and one persistent volume.
export function sqliteStore(file){
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const sql=new DatabaseSync(file);chmodSync(file,0o600);
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
  class Statement {
    constructor(query,values=[]){this.query=query;this.values=values;}
    bind(...values){return new Statement(this.query,values);}
    async first(){return sql.prepare(this.query).get(...this.values)??null;}
    async all(){return {results:sql.prepare(this.query).all(...this.values)};}
    async run(){return this.execute();}
    execute(){const result=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(result.changes)}};}
  }
  return {sql,prepare:query=>new Statement(query),batch:async statements=>{
    sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}
  },close:()=>sql.close()};
}
export function migrate(store,directory){
  const {sql}=store;sql.exec('CREATE TABLE IF NOT EXISTS campus_schema_migrations(name TEXT PRIMARY KEY,hash TEXT NOT NULL)');
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
    const source=readFileSync(path.join(directory,name),'utf8'),hash=createHash('sha256').update(source).digest('hex');
    const prior=sql.prepare('SELECT hash FROM campus_schema_migrations WHERE name=?').get(name);
    if(prior){if(prior.hash!==hash)throw new Error('已应用的数据库迁移发生变化：'+name);continue;}
    sql.exec('BEGIN IMMEDIATE');try{sql.exec(source);sql.prepare('INSERT INTO campus_schema_migrations(name,hash) VALUES(?,?)').run(name,hash);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const store=sqliteStore(process.env.CAMPUS_DB_PATH??'.campus-local/world.sqlite');
  try{migrate(store,path.resolve('drizzle'));console.log('校园数据库迁移完成。');}finally{store.close();}
}
