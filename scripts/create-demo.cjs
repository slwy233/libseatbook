const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'outputs/web');
const output = path.join(root, 'outputs/demo');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Run npm run export:web first.');
fs.cpSync(source, output, { recursive: true });
const fixture = `(() => {
  const date = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  const today = date(new Date()); const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate()+1);
  const tomorrow = date(tomorrowDate);
  const user = {fullName:'演示同学', username:'DEMO', collegeDepName:'模拟数据', scoreNum:100, breachNum:0, totalMake:12};
  let booking = { id:'demo-booking', status:'RESERVE', seatLabel:'75', buildName:'图书馆', floorName:'三层', roomName:'自主学习区', makeDateStr:today, makeBeginStr:'14:00', makeEndStr:'18:00', makeBegin:840, makeEnd:1080 };
  const buildings = [{id:'demo-building', name:'图书馆', seTime:'08:00 – 21:50', floors:[{id:'3',name:'三层'},{id:'4',name:'四层'}]}];
  const rooms = [{id:'demo-room', name:'自主学习区', floorName:'三层', seatFree:26, seatTotal:36, seatPower:20, seatWindows:8}, {id:'demo-room-2',name:'安静阅览区',floorName:'四层',seatFree:10,seatTotal:24,seatPower:0}];
  const seats = Object.fromEntries(Array.from({length:36},(_,i)=>[String(i+1),{id:String(i+1),label:String(i+61),status:i%4===0?'BOOKED':i===3?'STOP':'FREE'}]));
  let tasks = [{id:'demo-task',enabled:true,dateFrom:today,dateTo:tomorrow,buildingName:'图书馆',roomName:'自主学习区',startTime:'08:00',endTime:'12:00',preferredSeats:['75','80'],results:{[today]:'⚠️ 已有预约，保留现有预约'}}];
  const ok = data => ({status:true,data});
  localStorage.setItem('@seat_token','DEMO_TOKEN');
  localStorage.setItem('@seat_user_info',JSON.stringify(user));
  localStorage.setItem('@seat_username','DEMO');
  localStorage.setItem('@seat_password','DEMO_ONLY');
  localStorage.setItem('@seat_system_info',JSON.stringify({hmac:0}));
  window.__demoRequests = [];
  window.fetch = async (url, options={}) => {
    const u = new URL(String(url), location.href); const p=u.pathname;
    window.__demoRequests.push({path:p,method:options.method||'GET'});
    let result;
    if (p.endsWith('/getSysSet/PC')) result=ok({hmac:0});
    else if (p.endsWith('/getUserInfo')) result=ok(user);
    else if (p.endsWith('/currentUseMake')) result=ok(booking);
    else if (p.endsWith('/lastMake')) result=ok([{...booking,id:'past-demo',status:'COMPLETE',seatLabel:'80'}]);
    else if (p.endsWith('/buildingFloorDate')) result=ok({buildings,dates:[today,tomorrow]});
    else if (p.includes('/findRoomDuration/')) result=ok({pageList:rooms,totalCount:rooms.length,currentPage:1});
    else if (p.includes('/freeSeatIdsDuration/')) result=ok(seats);
    else if (p.includes('/getStartTimes/')) result=ok([['840','14:00'],['900','15:00'],['960','16:00']]);
    else if (p.includes('/getEndTimes/')) result=ok([['1080','18:00'],['1140','19:00'],['1200','20:00']]);
    else if (p.includes('/freeBook/')) {result=ok({});}
    else if (p.includes('/make/cancel/')) {booking=null;result=ok({});}
    else if (p==='/api/schedules'&&(!options.method||options.method==='GET')) result=ok(tasks);
    else if (p==='/api/schedules'&&options.method==='POST') {
      const body=JSON.parse(options.body); const task={...body,id:'created-'+tasks.length,enabled:true,results:{}};
      delete task.encryptedUsername;delete task.encryptedPassword;tasks.push(task);result=ok(task);
    } else if (p==='/api/schedules/execute') result={status:true,message:'模拟执行完成，没有真实预约'};
    else if (p.startsWith('/api/schedules/')&&options.method==='DELETE') {tasks=tasks.filter(t=>t.id!==p.split('/').pop());result=ok({});}
    else if (p.startsWith('/api/schedules/')&&options.method==='PATCH') {const t=tasks.find(t=>t.id===p.split('/').pop());Object.assign(t,JSON.parse(options.body));result=ok({});}
    else if(p.endsWith('/auth/user')) result=ok({token:'DEMO_TOKEN',userInfoRes:user});
    else throw new Error('Offline preview blocked request '+p);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  class DemoXHR {
    open(method,url){this.url=url;}setRequestHeader(){}
    send(){this.status=200;this.readyState=4;this.responseText=JSON.stringify(ok({captchaId:'demo',captchaText:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="110" height="48"><text x="10" y="32" font-size="24">1234</text></svg>')}));queueMicrotask(()=>this.onreadystatechange?.());}
  }
  window.XMLHttpRequest=DemoXHR;
})();`;
const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8').replace('<head>', '<head><script>'+fixture+'</script>');
fs.writeFileSync(path.join(output, 'app.html'), html);
fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><title>天商书座 · 离线界面预览</title><style>*{box-sizing:border-box}body{margin:0;background:#e7edf6;font:14px system-ui;color:#17243b;display:flex;gap:28px;justify-content:center;align-items:center;min-height:100vh;padding:24px}aside{width:220px;line-height:1.8}h1{font-size:24px}iframe{width:390px;height:844px;max-height:94vh;border:8px solid #17243b;border-radius:30px;background:white;box-shadow:0 20px 60px #18284030}small{color:#64748b}@media(max-width:700px){aside{display:none}body{padding:0}iframe{width:100vw;height:100dvh;max-height:none;border:0;border-radius:0}}</style><aside><h1>天商书座</h1><p>优化后界面预览</p><p><b>全部为模拟数据</b><br>请求由本页本地响应，<br>不会连接学校或定时服务。</p><small>首页 · 选座 · 定时 · 我的预约<br>可点击底部导航体验流程。</small></aside><iframe title="天商书座离线预览" src="app.html"></iframe></html>`);
console.log('Offline demo written to outputs/demo. All application network requests are mocked.');

