import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const budgetDay=now=>new Date(now+8*3600000).toISOString().slice(0,10);
export class RunnerLedger {
  constructor(file,binding,clock=()=>Date.now()){
    this.clock=clock;this.lock=randomUUID();
    mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);chmodSync(file,0o600);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS runner(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL,state TEXT NOT NULL,lock_id TEXT,lock_until INTEGER NOT NULL DEFAULT 0)');
    this.db.prepare('INSERT OR IGNORE INTO runner(id,binding,state) VALUES(1,?,?)').run(binding,JSON.stringify({day:budgetDay(clock()),calls:0,tokens:0,totalCalls:0,totalTokens:0,pending:null,halt:''}));
    const row=this.db.prepare('SELECT binding FROM runner WHERE id=1').get();
    if(row.binding!==binding){this.db.close();throw new Error('此运行目录已绑定其他角色，请为每位角色使用独立的 RUNNER_DATA_DIR。');}
    const acquired=this.db.prepare('UPDATE runner SET lock_id=?,lock_until=? WHERE id=1 AND lock_until<=?').run(this.lock,clock()+180000,clock());
    if(!acquired.changes){this.db.close();throw new Error('这个角色已有连接程序运行；异常退出后最多等待三分钟再启动。');}
    this.state=JSON.parse(this.db.prepare('SELECT state FROM runner WHERE id=1').get().state);
    this.rotate();
    if(this.state.pending?.phase==='requested'){this.state.halt='上次模型调用中断，用量可能已产生。核对模型账单后使用 --resume 继续；预留用量不会清零。';this.state.pending=null;this.save();}
  }
  save(){
    if(!this.db.prepare('UPDATE runner SET state=?,lock_until=? WHERE id=1 AND lock_id=? AND lock_until>?').run(JSON.stringify(this.state),this.clock()+180000,this.lock,this.clock()).changes)throw new Error('运行锁已失效，已停止新的模型调用。');
  }
  rotate(){if(this.state.day!==budgetDay(this.clock())){this.state.day=budgetDay(this.clock());this.state.calls=0;this.state.tokens=0;this.save();}}
  reserve(leaseId,tokens,limits){
    this.rotate();const s=this.state;
    if(s.halt||s.pending||s.calls>=limits.calls||s.tokens+tokens>limits.tokens||s.totalTokens+tokens>limits.totalTokens)return false;
    s.calls++;s.totalCalls++;s.tokens+=tokens;s.totalTokens+=tokens;
    s.pending={leaseId,day:s.day,reservation:tokens,phase:'requested',action:null};this.save();return true;
  }
  settle(usage,action){
    const s=this.state,p=s.pending;if(!p)throw new Error('缺少本次调用的预留记录。');
    const valid=usage&&Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens>=0&&Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens>=0;
    if(!valid){s.halt='模型没有返回有效用量；保留预留值并停止。核查后可 --resume。';s.pending=null;this.save();return;}
    const used=usage.inputTokens+usage.outputTokens,delta=used-p.reservation;
    if(s.day===p.day)s.tokens+=delta;s.totalTokens+=delta;
    if(used>p.reservation)s.halt='模型实际用量超过本次预留，已停止后续调用。核查预算后可 --resume。';
    p.phase='decided';p.action=action;this.save();
  }
  halt(message){this.state.halt=message;this.state.pending=null;this.save();}
  complete(){this.state.pending=null;this.save();}
  resume(){this.state.halt='';this.save();}
  close(){try{this.db.prepare('UPDATE runner SET lock_id=NULL,lock_until=0 WHERE id=1 AND lock_id=?').run(this.lock);}finally{this.db.close();}}
}
