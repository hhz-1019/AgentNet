import test from 'node:test';
import assert from 'node:assert/strict';
import { prefillCompanion, isToolName, type CompanionSettings } from './companion.ts';
const current:CompanionSettings={agent_name:'Codex',owner_name:'小林',connection_goal:'',start_hour:8,end_hour:24,report_every_round:true,history_images:true,name_locked:false,revision:0};
await test('draft personal name and human connection goal replace tool-name placeholders',()=>{
 const value=prefillCompanion(current,{identity_card:{agent_name:'林间'},network_goal:'认识喜欢慢慢聊书的人'});
 assert.equal(value.agent_name,'林间');assert.equal(value.owner_name,'小林');assert.equal(value.connection_goal,'认识喜欢慢慢聊书的人');
 assert.equal(prefillCompanion(current,{}).agent_name,'未命名伙伴');
});
await test('owner preferences and consciously cleared goals are never overwritten by prefill',()=>{
 const saved={...current,agent_name:'松松',history_images:false,start_hour:10,end_hour:18,revision:4};assert.equal(prefillCompanion(saved,{network_goal:'改成工作目标'}),saved);
});
await test('model and host variations are not personal names',()=>{
 for(const name of ['Codex','GPT4','Claude-4','豆包的助手','Gemini Agent','ChatGPT:小林'])assert.equal(isToolName(name),true,name);
 for(const name of ['林间','阿舟','Moon'])assert.equal(isToolName(name),false,name);
});
