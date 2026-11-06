import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {chatView,saveChatView} from '../src/desktop/chatView.ts';

const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let values;
beforeEach(()=>{values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}})});
afterEach(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage});
const chat=(id,agent='codex',hasConversation=true)=>({id,agent,hasConversation});

test('switching a chat leaves other chats and the legacy default unchanged',()=>{
 const a=chat('independent-a'),b=chat('independent-b'),c=chat('independent-c','claude');values.set('mrmak.chatView.default','conversation');
 assert.equal(chatView(a),'terminal');assert.equal(chatView(b),'terminal');assert.equal(chatView(c),'terminal');
 saveChatView(a.id,'conversation');assert.equal(chatView(a),'conversation');assert.equal(chatView(b),'terminal');assert.equal(chatView(c),'terminal');
 saveChatView(c.id,'conversation');saveChatView(a.id,'terminal');assert.equal(chatView(a),'terminal');assert.equal(chatView(b),'terminal');assert.equal(chatView(c),'conversation');assert.equal(values.get('mrmak.chatView.default'),'conversation');
});

test('each saved choice survives module reload and another chat changing modes',async()=>{
 saveChatView('reload-a','conversation');saveChatView('reload-b','terminal');
 const reopened=await import('../src/desktop/chatView.ts?independent-reload');
 assert.equal(reopened.chatView(chat('reload-a')),'conversation');assert.equal(reopened.chatView(chat('reload-b')),'terminal');
 reopened.saveChatView('reload-b','conversation');assert.equal(reopened.chatView(chat('reload-a')),'conversation');assert.equal(reopened.chatView(chat('reload-b')),'conversation');
});

test('CLI setup and unsupported providers stay in terminal unless a supported chat was explicitly changed',()=>{
 values.set('mrmak.chatView.default','conversation');assert.equal(chatView(chat('new-setup','claude',false)),'terminal');
 for(const agent of ['shell','opencode','kimi','antigravity']){const session=chat('unsupported-'+agent,agent);saveChatView(session.id,'conversation');assert.equal(chatView(session),'terminal')}
});

test('storage failure keeps the choice in this window for only the affected chat',()=>{
 const a=chat('storage-a'),b=chat('storage-b');saveChatView(a.id,'terminal');const write=localStorage.setItem;localStorage.setItem=()=>{throw Error('Storage full')};
 saveChatView(a.id,'conversation');assert.equal(chatView(a),'conversation');assert.equal(chatView(b),'terminal');
 localStorage.setItem=write;saveChatView(a.id,'terminal');assert.equal(chatView(a),'terminal');assert.equal(values.get('mrmak.chatView.storage-a'),'terminal');
});
