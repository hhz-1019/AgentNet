import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const db = await PGlite.create();
await db.exec(`CREATE TABLE agents(agent_id BIGINT PRIMARY KEY,identity_state TEXT NOT NULL DEFAULT 'active');
INSERT INTO agents(agent_id) VALUES(1),(2),(3);
CREATE TABLE agent_owners(agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),owner_uid TEXT NOT NULL);
INSERT INTO agent_owners VALUES(1,'independent-owner-A'),(2,'independent-owner-B'),(3,'independent-owner-C');`);
await db.exec((await readFile('core/migrations/000157_collaboration.sql','utf8')).split('-- +goose Down')[0]);
const port=Number(process.env.AGENTNET_COLLABORATION_TEST_PORT||15443);
const socket=new PGLiteSocketServer({db,port,host:'127.0.0.1'});
await mkdir('.agentnet-audit',{recursive:true});
const wireFixture=resolve(`.agentnet-audit/collaboration-wire-${process.pid}`);
await mkdir(wireFixture,{recursive:true});
const errorFixture=resolve(`.agentnet-audit/collaboration-error-${process.pid}.json`);
await new Promise((done,reject)=>{
 const child=spawn(process.env.AGENTNET_GO_BINARY||'go',['test','./internal/client','-run','^TestCollaborationRequestWire$','-count=1','-v'],{cwd:resolve('core/cli'),env:{...process.env,AGENTNET_COLLABORATION_WIRE_FIXTURE:wireFixture},stdio:'inherit'});
 child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('CLI wire fixture failed')));
});
await socket.start();
try {
 process.exitCode=await new Promise((done,reject)=>{
  const child=spawn(process.env.AGENTNET_GO_BINARY||'go',['test','./api/consolev2','-run','^TestCollaboration','-count=1','-v'],{
   cwd:resolve('core'),env:{...process.env,AGENTNET_COLLABORATION_WIRE_FIXTURE:wireFixture,AGENTNET_COLLABORATION_ERROR_FIXTURE:errorFixture,AGENTNET_COLLABORATION_TEST_DSN:`host=127.0.0.1 port=${port} user=postgres dbname=postgres sslmode=disable`},stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>done(code??1));
 });
 if(process.exitCode===0) process.exitCode=await new Promise((done,reject)=>{
  const child=spawn(process.env.AGENTNET_GO_BINARY||'go',['test','./internal/client','./cmd','-run','^TestCollaboration','-count=1','-v'],{cwd:resolve('core/cli'),env:{...process.env,AGENTNET_COLLABORATION_ERROR_FIXTURE:errorFixture},stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>done(code??1));
 });
} finally {await socket.stop();await db.close();await rm(errorFixture,{force:true});await rm(wireFixture,{recursive:true,force:true});}
