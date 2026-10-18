const { contextBridge } = require('electron');
const core = require('../../packages/core/dist/index.js');
const graph = core.createCanvas('node-model-ui');
for (const type of ['text-to-image','image-to-image','text-to-video','image-to-video','video-to-video']) {
  core.addNode(graph,type,{prompt:'Model selection preview',...(type==='image-to-video'?{durationMs:5000}:{}),
    ...(type==='text-to-image'?{model:'legacy-image-model'}:{}),...(type==='video-to-video'?{model:'ep-existing-video'}:{})},type);
}
contextBridge.exposeInMainWorld('api', {
  onCanvasChanged: () => () => {},
  invoke: async (channel,payload={}) => {
    if(channel==='project.open')return {id:'test',path:payload.path,name:'Node Model UI Test',settings:{width:1280,height:720,fps:24},timeline:{schemaVersion:1,tracks:[]}};
    if(channel==='config.get')return {provider:{default:'volcengine',volcengine:{imageModel:'project-image-default',videoModel:'doubao-seedance-2-0-mini-260615'}}};
    if(channel==='canvas.list')return [{id:graph.id,nodeCount:graph.nodes.length}];
    if(channel==='canvas.get')return graph;
    if(channel==='canvas.node.set-param')return core.setNodeParams(graph,payload.nodeId,payload.params);
    if(['asset.list','preset.list','job.list','agent.conversations.list'].includes(channel))return [];
    if(channel==='agent.history'||channel==='agent.get-run')return {messages:[],events:[],run:null};
    if(channel==='timeline.get')return {schemaVersion:1,tracks:[]};
    throw Error('Unexpected test channel: '+channel);
  }
});
contextBridge.exposeInMainWorld('nodeModelTest',{snapshot:()=>graph});
