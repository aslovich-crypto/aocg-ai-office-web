import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const C = {
  cherry:    "#A4161A",
  cherryD:   "#7a1014",
  cherryL:   "#F2E0E0",
  cherryM:   "#D4888A",
  dark:      "#161A1D",
  mid:       "#404040",
  gray:      "#6B7280",
  grayL:     "#9CA3AF",
  silver:    "#E8E4E0",
  lightGray: "#F0EDEA",
  light:     "#f5f3f0",
  white:     "#ffffff",
};

const FONT = "'Georgia', 'Times New Roman', serif";
const PAYMENT_METHODS = ["Корпоративная карта", "Наличные", "Личная карта", "Не указано"];
const CATEGORIES = ["Питание", "Транспорт", "Топливо", "Продукты", "Гостиница", "Канцелярия", "Прочее"];

const INITIAL_RECEIPTS = [
  { id:1, date:"2026-05-05", org:"Яндекс.Такси",  category:"Транспорт", payment:"Не указано",          amount:2043    },
  { id:2, date:"2026-03-19", org:"Азбука вкуса",   category:"Продукты",  payment:"Корпоративная карта", amount:8274    },
  { id:3, date:"2026-03-15", org:"Мере",           category:"Питание",   payment:"Наличные",            amount:3500    },
  { id:4, date:"2026-04-10", org:"Лукойл",         category:"Топливо",   payment:"Корпоративная карта", amount:5985.97 },
  { id:5, date:"2026-04-20", org:"Брискли",        category:"Питание",   payment:"Личная карта",        amount:1200    },
];

const FNS_RECEIPTS = [
  { id:101, date:"2026-05-08", org:"Лукойл",   amount:5985.97 },
  { id:102, date:"2026-05-07", org:"Брискли",  amount:1200    },
  { id:103, date:"2026-04-30", org:"ВкусВилл", amount:2340    },
];

const ROLES = [
  { id:"admin",      label:"Администратор", desc:"Заводит кабинет компании, регистрирует сотрудников, управляет лицензией." },
  { id:"employee",   label:"Сотрудник",     desc:"Добавляет первичные документы, создаёт отчёты и отправляет на проверку." },
  { id:"manager",    label:"Руководитель",  desc:"Проверяет отчёты: возвращает, одобряет или отклоняет. Смотрит статистику." },
  { id:"accountant", label:"Бухгалтер",     desc:"Регистрирует сотрудников, проверяет и выгружает отчёты в 1С." },
];

const fmt = n => Number(n).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})+" ₽";
const fmtDate = s => new Date(s).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"});
const monthLabel = s => new Date(s).toLocaleDateString("ru-RU",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase());

function groupByMonth(items) {
  const g={};
  items.forEach(r=>{const k=r.date.slice(0,7);if(!g[k])g[k]={label:monthLabel(r.date),items:[]};g[k].items.push(r);});
  return Object.entries(g).sort((a,b)=>b[0].localeCompare(a[0]));
}

// ─── ATOMS ────────────────────────────────────────────────

function SectionHead({num,title}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0 8px"}}>
      <div style={{width:20,height:20,background:C.cherry,color:C.white,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,flexShrink:0}}>{num}</div>
      <span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>{title}</span>
      <div style={{flex:1,height:"0.5px",background:C.silver}}/>
    </div>
  );
}

function Btn({children,onClick,disabled,outline,full,small}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:disabled?C.lightGray:outline?"transparent":C.cherry,
      color:disabled?C.grayL:outline?C.cherry:C.white,
      border:`1.5px solid ${disabled?C.silver:C.cherry}`,
      padding:small?"6px 12px":"9px 18px",
      fontFamily:FONT,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",
      cursor:disabled?"default":"pointer",transition:"all 0.15s",width:full?"100%":"auto"
    }}>{children}</button>
  );
}

function RuleInput({label,value,onChange,type="text",placeholder}) {
  const [f,setF]=useState(false);
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,marginBottom:4,fontFamily:FONT}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",border:"none",borderBottom:`1.5px solid ${f?C.cherry:C.silver}`,outline:"none",
          padding:"7px 0",fontSize:13,fontFamily:FONT,color:C.dark,background:"transparent",boxSizing:"border-box",transition:"border-color 0.2s"}}/>
    </div>
  );
}

function Toggle({value,onChange}) {
  return (
    <div onClick={()=>onChange(!value)} style={{width:34,height:18,background:value?C.cherry:C.silver,position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
      <div style={{position:"absolute",top:2,left:value?16:2,width:12,height:12,background:C.white,boxShadow:"0 1px 3px rgba(0,0,0,0.15)",transition:"left 0.2s"}}/>
    </div>
  );
}

function TabBar({tabs,active,onSelect}) {
  return (
    <div style={{display:"flex",borderBottom:`1px solid ${C.silver}`,background:C.white,overflowX:"auto"}}>
      {tabs.map(t=>(
        <button key={t} onClick={()=>onSelect(t)} style={{
          padding:"10px 14px",border:"none",background:"transparent",
          color:active===t?C.cherry:C.gray,fontFamily:FONT,fontSize:10,
          letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",
          whiteSpace:"nowrap",flexShrink:0,
          borderBottom:active===t?`2px solid ${C.cherry}`:"2px solid transparent",
          transition:"all 0.15s"
        }}>{t}</button>
      ))}
    </div>
  );
}

function Block({children,style:s}) {
  return <div style={{background:C.lightGray,borderLeft:`3px solid ${C.cherryM}`,padding:"10px 14px",marginBottom:10,...s}}>{children}</div>;
}

function Modal({title,onClose,children,footer}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}}>
      <div style={{background:C.white,width:"100%",maxWidth:480,borderTop:`3px solid ${C.cherry}`,maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
        <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:3,height:14,background:C.cherry}}/>
            <span style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.dark,fontFamily:FONT}}>{title}</span>
          </div>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        <div style={{overflow:"auto",flex:1,padding:"4px 16px 8px"}}>{children}</div>
        {footer&&<div style={{padding:"10px 16px",borderTop:`1px solid ${C.silver}`,background:C.lightGray,flexShrink:0}}>{footer}</div>}
      </div>
    </div>
  );
}

function Donut({title,data,num}) {
  const pal=[C.cherry,C.cherryM,"#C45558","#E8A0A2","#D4888A"];
  return (
    <div style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:8}}>
      <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:16,height:16,background:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.white,fontFamily:FONT}}>{num}</div>
        <span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>{title}</span>
      </div>
      <div style={{padding:"10px 14px"}}>
        <ResponsiveContainer width="100%" height={140}>
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={60} paddingAngle={2} startAngle={90} endAngle={-270}>
              {data.map((_,i)=><Cell key={i} fill={pal[i%pal.length]}/>)}
            </Pie>
            <Tooltip formatter={v=>fmt(v)} contentStyle={{background:C.white,border:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:11}}/>
          </PieChart>
        </ResponsiveContainer>
        {data.map((d,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`0.5px solid ${C.silver}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,background:pal[i%pal.length],flexShrink:0}}/>
              <span style={{fontSize:12,color:C.dark,fontFamily:FONT}}>{d.name}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:10,color:C.gray,fontFamily:FONT}}>{d.count} оп.</span>
              <span style={{fontSize:13,color:C.cherry,fontFamily:FONT,fontWeight:700}}>{fmt(d.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PAGES ────────────────────────────────────────────────

function SvodkaPage({receipts}) {
  const [period,setPeriod]=useState("За месяц");
  const [showP,setShowP]=useState(false);
  const PERIODS=["За месяц","За квартал","За год","За всё время","Заданный период"];
  const total=receipts.reduce((s,r)=>s+r.amount,0);
  const orgMap={},payMap={},catMap={};
  receipts.forEach(r=>{
    if(!orgMap[r.org])orgMap[r.org]={value:0,count:0}; orgMap[r.org].value+=r.amount; orgMap[r.org].count++;
    if(!payMap[r.payment])payMap[r.payment]={value:0,count:0}; payMap[r.payment].value+=r.amount; payMap[r.payment].count++;
    if(!catMap[r.category])catMap[r.category]={value:0,count:0}; catMap[r.category].value+=r.amount; catMap[r.category].count++;
  });
  return (
    <div style={{paddingBottom:80}}>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"12px 16px"}}>
        <div style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,marginBottom:4,fontFamily:FONT}}>Сотрудник</div>
        <div style={{border:`1px solid ${C.silver}`,padding:"8px 12px",marginBottom:10,display:"flex",justifyContent:"space-between",background:C.lightGray,cursor:"pointer"}}>
          <span style={{fontSize:13,fontFamily:FONT,color:C.dark}}>Все сотрудники</span>
          <span style={{color:C.gray}}>▾</span>
        </div>
        <div style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,marginBottom:4,fontFamily:FONT}}>Период</div>
        <div onClick={()=>setShowP(true)} style={{border:`1px solid ${C.cherry}`,padding:"8px 12px",marginBottom:10,display:"flex",justifyContent:"space-between",cursor:"pointer",background:C.cherryL}}>
          <span style={{fontSize:13,fontFamily:FONT,color:C.cherry}}>{period}</span>
          <span style={{color:C.cherry}}>▾</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["Дата от","08.04.2026"],["Дата до","08.05.2026"]].map(([l,v])=>(
            <div key={l}>
              <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:4,fontFamily:FONT}}>{l}</div>
              <div style={{border:`1px solid ${C.silver}`,padding:"8px 12px",display:"flex",justifyContent:"space-between",background:C.white}}>
                <span style={{fontSize:12,fontFamily:FONT,color:C.dark}}>{v}</span>
                <span style={{color:C.grayL,fontSize:11}}>▦</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{padding:"12px 16px"}}>
        <div style={{background:C.white,border:`1px solid ${C.silver}`,padding:"14px 16px",marginBottom:10,borderLeft:`3px solid ${C.cherry}`}}>
          <div style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Итого за период</div>
          <div style={{fontSize:28,fontWeight:700,color:C.cherry,fontFamily:FONT,marginBottom:8}}>{fmt(total)}</div>
          <div style={{height:2,background:`linear-gradient(90deg, ${C.cherry}, ${C.cherryM}, ${C.cherryL})`,marginBottom:8}}/>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:8,height:8,background:C.cherry}}/>
            <span style={{fontSize:11,color:C.gray,fontFamily:FONT}}>100% · Не указано</span>
          </div>
        </div>
        <Donut title="Сотрудники" data={[{name:"Алексей Шукалович",value:total,count:receipts.length}]} num="01"/>
        <Donut title="Организации" data={Object.entries(orgMap).map(([name,d])=>({name,...d}))} num="02"/>
        <Donut title="Методы оплаты" data={Object.entries(payMap).map(([name,d])=>({name,...d}))} num="03"/>
        <Donut title="Категории" data={Object.entries(catMap).map(([name,d])=>({name,...d}))} num="04"/>
      </div>
      {showP&&(
        <div style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.4)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={()=>setShowP(false)}>
          <div style={{background:C.white,width:"100%",maxWidth:480,borderTop:`3px solid ${C.cherry}`}} onClick={e=>e.stopPropagation()}>
            <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:C.cherry}}/><span style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.dark,fontFamily:FONT}}>Период</span></div>
              <button onClick={()=>setShowP(false)} style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:16}}>✕</button>
            </div>
            {PERIODS.map(p=>(
              <div key={p} onClick={()=>{setPeriod(p);setShowP(false);}}
                style={{padding:"13px 16px",borderBottom:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:13,
                  color:period===p?C.cherry:C.dark,background:period===p?C.cherryL:C.white,
                  cursor:"pointer",borderLeft:period===p?`3px solid ${C.cherry}`:"3px solid transparent"}}>{p}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OperaciiPage({receipts,setReceipts}) {
  const [tab,setTab]=useState("Чеки");
  const [search,setSearch]=useState("");
  const [showFns,setShowFns]=useState(false);
  const [fnsSelected,setFnsSelected]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({org:"",amount:"",category:"Питание",payment:"Не указано",date:new Date().toISOString().split("T")[0]});
  const filtered=receipts.filter(r=>!search||r.org.toLowerCase().includes(search.toLowerCase()));
  const groups=groupByMonth(filtered);
  function loadFns(){setReceipts(prev=>[...FNS_RECEIPTS.filter(f=>fnsSelected.includes(f.id)).map(f=>({id:Date.now()+f.id,date:f.date,org:f.org,category:"Прочее",payment:"Не указано",amount:f.amount})),...prev]);setShowFns(false);setFnsSelected([]);}
  function addR(){setReceipts(prev=>[{id:Date.now(),date:form.date,org:form.org,category:form.category,payment:form.payment,amount:Number(form.amount)},...prev]);setShowAdd(false);setForm({org:"",amount:"",category:"Питание",payment:"Не указано",date:new Date().toISOString().split("T")[0]});}
  return (
    <div style={{position:"relative"}}>
      <TabBar tabs={["Чеки","Онлайн чеки"]} active={tab} onSelect={setTab}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px"}}>
        <div style={{display:"flex",alignItems:"center",border:`1px solid ${C.silver}`,padding:"7px 12px",gap:8,marginBottom:8,background:C.lightGray}}>
          <span style={{color:C.grayL}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..." style={{border:"none",outline:"none",flex:1,fontSize:13,background:"none",fontFamily:FONT,color:C.dark}}/>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setShowFns(true)} style={{border:`1px solid ${C.cherryM}`,background:C.cherryL,padding:"5px 10px",color:C.cherry,fontFamily:FONT,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer"}}>Импорт из ФНС</button>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}><Toggle value={false} onChange={()=>{}}/><span style={{fontSize:10,color:C.gray,fontFamily:FONT}}>Недавние</span></div>
        </div>
      </div>
      <div style={{paddingBottom:80}}>
        {groups.map(([key,group])=>(
          <div key={key}>
            <div style={{padding:"6px 16px",background:C.lightGray,borderBottom:`1px solid ${C.silver}`,borderTop:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:2,height:10,background:C.cherryM}}/><span style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,fontFamily:FONT}}>{group.label}</span>
            </div>
            {group.items.map(r=>(
              <div key={r.id} style={{background:C.white,padding:"11px 16px",borderBottom:`1px solid ${C.silver}`,display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:34,height:34,background:C.lightGray,border:`1px solid ${C.silver}`,color:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontFamily:FONT,flexShrink:0,fontWeight:700}}>{r.org[0]}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:13,fontFamily:FONT,color:C.dark,fontWeight:700}}>{r.org}</span>
                    <button onClick={()=>setReceipts(prev=>prev.filter(x=>x.id!==r.id))} style={{border:"none",background:"none",color:C.silver,cursor:"pointer",fontSize:13,padding:0}}>✕</button>
                  </div>
                  <span style={{display:"inline-block",background:C.cherryL,color:C.cherry,fontSize:10,padding:"2px 8px",fontFamily:FONT,border:`1px solid ${C.cherryM}22`,marginBottom:5}}>{r.category}</span>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,color:C.gray,fontFamily:FONT}}>{fmtDate(r.date)} · {r.payment}</span>
                    <span style={{fontSize:14,fontFamily:FONT,color:C.cherry,fontWeight:700}}>{fmt(r.amount)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {groups.length===0&&<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{color:C.grayL,fontFamily:FONT,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>Нет операций</div></div>}
      </div>
      <button onClick={()=>setShowAdd(true)} style={{position:"fixed",bottom:80,right:20,width:44,height:44,background:C.cherry,color:C.white,border:"none",fontSize:20,cursor:"pointer",boxShadow:`0 4px 12px rgba(164,22,26,0.35)`,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      {showFns&&(
        <Modal title="Операции из ФНС" onClose={()=>{setShowFns(false);setFnsSelected([]);}}
          footer={<div style={{display:"flex",gap:6}}><button onClick={()=>setFnsSelected(FNS_RECEIPTS.map(f=>f.id))} style={{flex:1,background:C.lightGray,border:`1px solid ${C.silver}`,padding:"8px",fontFamily:FONT,fontSize:10,textTransform:"uppercase",cursor:"pointer",color:C.mid,letterSpacing:"0.06em"}}>Все</button><button onClick={()=>setFnsSelected([])} style={{flex:1,background:C.lightGray,border:`1px solid ${C.silver}`,padding:"8px",fontFamily:FONT,fontSize:10,textTransform:"uppercase",cursor:"pointer",color:C.mid,letterSpacing:"0.06em"}}>Сброс</button><Btn onClick={loadFns} disabled={!fnsSelected.length}>Загрузить</Btn></div>}>
          <div style={{padding:"10px 0 4px",fontSize:11,color:C.gray,fontFamily:FONT}}>Выберите операции для отчётов</div>
          {FNS_RECEIPTS.map(f=>{const sel=fnsSelected.includes(f.id);return(
            <div key={f.id} onClick={()=>setFnsSelected(prev=>sel?prev.filter(x=>x!==f.id):[...prev,f.id])} style={{padding:"10px 0",borderBottom:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:10,cursor:"pointer",background:sel?C.cherryL:C.white}}>
              <div style={{width:14,height:14,border:`1.5px solid ${sel?C.cherry:C.silver}`,background:sel?C.cherry:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:8,flexShrink:0}}>{sel&&"✓"}</div>
              <div style={{width:30,height:30,background:C.lightGray,border:`1px solid ${C.silver}`,color:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:12,fontWeight:700}}>{f.org[0]}</div>
              <div style={{flex:1}}><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>{f.org}</div><div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>{fmtDate(f.date)}</div></div>
              <span style={{fontFamily:FONT,fontSize:13,color:C.cherry,fontWeight:700}}>{fmt(f.amount)}</span>
            </div>
          );})}
        </Modal>
      )}
      {showAdd&&(
        <Modal title="Добавить чек" onClose={()=>setShowAdd(false)} footer={<Btn full onClick={addR} disabled={!form.org||!form.amount}>Добавить чек</Btn>}>
          <div style={{paddingTop:12}}>
            <RuleInput label="Организация" value={form.org} onChange={v=>setForm(p=>({...p,org:v}))} placeholder="Яндекс.Такси"/>
            <RuleInput label="Сумма (₽)" value={form.amount} onChange={v=>setForm(p=>({...p,amount:v}))} type="number" placeholder="0.00"/>
            <RuleInput label="Дата" value={form.date} onChange={v=>setForm(p=>({...p,date:v}))} type="date"/>
            <div style={{marginBottom:12}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Категория</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{CATEGORIES.map(c=><button key={c} onClick={()=>setForm(p=>({...p,category:c}))} style={{padding:"4px 10px",border:`1px solid ${form.category===c?C.cherry:C.silver}`,background:form.category===c?C.cherry:C.white,color:form.category===c?C.white:C.mid,fontFamily:FONT,fontSize:11,cursor:"pointer"}}>{c}</button>)}</div></div>
            <div style={{marginBottom:8}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Метод оплаты</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{PAYMENT_METHODS.map(m=><button key={m} onClick={()=>setForm(p=>({...p,payment:m}))} style={{padding:"4px 10px",border:`1px solid ${form.payment===m?C.cherry:C.silver}`,background:form.payment===m?C.cherryL:C.white,color:form.payment===m?C.cherry:C.mid,fontFamily:FONT,fontSize:11,cursor:"pointer"}}>{m}</button>)}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OtchetyPage({receipts}) {
  const [tab,setTab]=useState("Личные");
  const [reports,setReports]=useState([]);
  const [search,setSearch]=useState("");
  const [showC,setShowC]=useState(false);
  const [title,setTitle]=useState("");
  const [selected,setSelected]=useState([]);
  const usedIds=reports.flatMap(r=>r.receiptIds);
  const free=receipts.filter(r=>!usedIds.includes(r.id));
  function create(){const sel=free.filter(r=>selected.includes(r.id));setReports(prev=>[...prev,{id:Date.now(),title,status:"Личные",receiptIds:selected,total:sel.reduce((s,r)=>s+r.amount,0),date:new Date().toISOString().split("T")[0]}]);setTitle("");setSelected([]);setShowC(false);}
  const filtered=reports.filter(r=>r.status===tab&&(!search||r.title.toLowerCase().includes(search.toLowerCase())));
  const ST={"Личные":{bg:C.lightGray,color:C.mid,b:C.silver},"На проверке":{bg:"#FEF3C7",color:"#92400E",b:"#FCD34D"},"Одобрен":{bg:"#ECFDF5",color:"#065F46",b:"#6EE7B7"},"Отклонён":{bg:C.cherryL,color:C.cherry,b:C.cherryM}};
  return (
    <div>
      <TabBar tabs={["Личные","На проверке","Номинальные"]} active={tab} onSelect={setTab}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px",display:"flex",gap:8}}>
        <div style={{flex:1,display:"flex",alignItems:"center",border:`1px solid ${C.silver}`,padding:"7px 12px",gap:8,background:C.lightGray}}><span style={{color:C.grayL}}>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..." style={{border:"none",outline:"none",flex:1,fontSize:13,background:"none",fontFamily:FONT,color:C.dark}}/></div>
        <Btn small onClick={()=>setShowC(true)}>+ Новый</Btn>
      </div>
      {filtered.length===0?(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"80px 20px",gap:16}}>
          <div style={{width:52,height:36,border:`1px solid ${C.silver}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.grayL,fontSize:18}}>▤</div>
          {tab==="Личные"?<Btn onClick={()=>setShowC(true)}>Создать первый отчёт</Btn>:<span style={{color:C.grayL,fontFamily:FONT,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>Отчёты отсутствуют</span>}
        </div>
      ):(
        <div style={{paddingBottom:80}}>
          <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,display:"grid",gridTemplateColumns:"1fr 100px 90px",padding:"7px 14px",gap:8}}>
            {["Наименование","Сумма","Статус"].map(h=><div key={h} style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,fontFamily:FONT}}>{h}</div>)}
          </div>
          {filtered.map(rep=>{const st=ST[rep.status]||ST["Личные"];return(
            <div key={rep.id} style={{background:C.white,borderBottom:`1px solid ${C.silver}`,borderLeft:`3px solid ${rep.status==="Личные"?C.silver:C.cherry}`}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 100px 90px",padding:"11px 14px",gap:8,alignItems:"center"}}>
                <div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700,marginBottom:2}}>{rep.title}</div><div style={{fontFamily:FONT,fontSize:10,color:C.gray}}>{fmtDate(rep.date)} · {rep.receiptIds.length} чеков</div></div>
                <div style={{fontFamily:FONT,fontSize:13,color:C.cherry,fontWeight:700,textAlign:"right"}}>{fmt(rep.total)}</div>
                <div style={{padding:"2px 6px",background:st.bg,border:`1px solid ${st.b}`,fontSize:9,fontFamily:FONT,color:st.color,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.04em"}}>{rep.status}</div>
              </div>
              {rep.status==="Личные"&&<div style={{padding:"0 14px 10px"}}><Btn small onClick={()=>setReports(prev=>prev.map(r=>r.id===rep.id?{...r,status:"На проверке"}:r))}>На проверку →</Btn></div>}
              {rep.status==="На проверке"&&<div style={{padding:"0 14px 10px",display:"flex",gap:6}}><Btn small onClick={()=>setReports(prev=>prev.map(r=>r.id===rep.id?{...r,status:"Одобрен"}:r))}>✓ Одобрить</Btn><Btn small outline onClick={()=>setReports(prev=>prev.map(r=>r.id===rep.id?{...r,status:"Отклонён"}:r))}>Отклонить</Btn></div>}
            </div>
          );})}
        </div>
      )}
      {showC&&(
        <Modal title="Новый отчёт" onClose={()=>setShowC(false)} footer={<Btn full onClick={create} disabled={!title||!selected.length}>Создать отчёт</Btn>}>
          <div style={{paddingTop:12}}>
            <RuleInput label="Название отчёта" value={title} onChange={setTitle} placeholder="Командировка, май 2026"/>
            <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:8,fontFamily:FONT}}>Выберите чеки · {selected.length} выбрано</div>
            {free.length===0&&<Block><span style={{fontFamily:FONT,fontSize:12,color:C.mid}}>Нет свободных чеков</span></Block>}
            {free.map(r=>{const sel=selected.includes(r.id);return(
              <div key={r.id} onClick={()=>setSelected(prev=>sel?prev.filter(x=>x!==r.id):[...prev,r.id])} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",marginBottom:4,border:`1px solid ${sel?C.cherry:C.silver}`,background:sel?C.cherryL:C.white,cursor:"pointer"}}>
                <div style={{width:12,height:12,border:`1.5px solid ${sel?C.cherry:C.silver}`,background:sel?C.cherry:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:8,flexShrink:0}}>{sel&&"✓"}</div>
                <div style={{flex:1}}><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>{r.org}</div><div style={{fontFamily:FONT,fontSize:10,color:C.gray}}>{fmtDate(r.date)} · {r.category}</div></div>
                <span style={{fontFamily:FONT,fontSize:13,color:C.cherry,fontWeight:700}}>{fmt(r.amount)}</span>
              </div>
            );})}
            {selected.length>0&&<Block><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Итого:</span><span style={{fontFamily:FONT,fontSize:14,color:C.cherry,fontWeight:700}}>{fmt(free.filter(r=>selected.includes(r.id)).reduce((s,r)=>s+r.amount,0))}</span></div></Block>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function NastroykiPage() {
  const [tab,setTab]=useState("Аккаунт");
  const [roles,setRoles]=useState({admin:true,employee:true,manager:true,accountant:true});
  return (
    <div>
      <TabBar tabs={["Аккаунт","Лицензии","Пользователи","Сервисы","Общие"]} active={tab} onSelect={setTab}/>
      {tab==="Аккаунт"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead num="01" title="Личные данные"/>
          {[["Имя","Алексей"],["Отчество","Иванович"],["Фамилия","Шукалович"],["Дата рождения","01.09.1980"],["Email","a.slovich@gmail.com"],["ИНН","7839112580"],["Регион","Россия"],["Табельный №","—"]].map(([k,v],i)=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",borderBottom:`1px solid ${C.silver}`,background:i%2===0?C.white:C.lightGray}}>
              <span style={{fontSize:11,color:C.gray,fontFamily:FONT,minWidth:120}}>{k}</span>
              <span style={{fontSize:13,color:C.dark,fontFamily:FONT}}>{v}</span>
            </div>
          ))}
          <SectionHead num="02" title="Права доступа"/>
          {ROLES.map(r=>(
            <div key={r.id} style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:6,borderLeft:roles[r.id]?`3px solid ${C.cherry}`:`3px solid ${C.silver}`}}>
              <div style={{padding:"11px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{fontFamily:FONT,fontSize:13,color:roles[r.id]?C.dark:C.gray,fontWeight:700}}>{r.label}</span>
                  <Toggle value={roles[r.id]} onChange={v=>setRoles(p=>({...p,[r.id]:v}))}/>
                </div>
                <div style={{fontFamily:FONT,fontSize:11,color:C.gray,lineHeight:1.5}}>{r.desc}</div>
              </div>
            </div>
          ))}
          <div style={{marginTop:14}}><Btn>Сохранить изменения</Btn></div>
        </div>
      )}
      {tab==="Лицензии"&&<div style={{padding:"12px 16px"}}><Block><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:24,height:24,background:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:12}}>✕</div><div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>Ваша лицензия истекла</div><div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Необходимо продление</div></div></div></Block><Btn>Продлить лицензию</Btn></div>}
      {tab==="Пользователи"&&<div style={{padding:"12px 16px"}}><SectionHead num="01" title="Сотрудники"/><div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,borderLeft:`3px solid ${C.cherry}`}}><div style={{width:34,height:34,background:C.cherry,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:11,fontWeight:700}}>АШ</div><div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>Алексей Шукалович</div><div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Директор · a.slovich@gmail.com</div></div></div></div>}
      {tab==="Сервисы"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead num="01" title="Мои чеки онлайн"/>
          <div style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:14}}>
            <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:C.cherryM}}/><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>МОИ ЧЕКИ ОНЛАЙН</span></div>
            <div style={{padding:"12px 14px"}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Привязанные номера</div><div style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:C.lightGray,border:`1px solid ${C.silver}`,marginBottom:10}}><span style={{fontSize:11,color:C.gray,fontFamily:FONT}}>Телефон</span><span style={{fontSize:13,color:C.dark,fontFamily:FONT}}>+7 921 868 44 41</span></div><Btn outline small>Добавить номер</Btn></div>
          </div>
          <SectionHead num="02" title="Интеграция с 1С"/>
          <div style={{background:C.white,border:`1px solid ${C.silver}`}}>
            <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:C.cherry}}/><span style={{fontWeight:900,fontSize:12,fontFamily:FONT,color:C.cherry}}>1С</span><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>ИНТЕГРАЦИЯ</span></div>
            <div style={{padding:"12px 14px"}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>API-ключ</div><Block><span style={{fontSize:11,color:C.mid,fontFamily:"Courier, monospace",wordBreak:"break-all"}}>93f9609eb68e15ecabf4efdccbad9b0d</span></Block><Btn outline small>Копировать ⎘</Btn></div>
          </div>
        </div>
      )}
      {tab==="Общие"&&(
        <div style={{padding:"12px 16px"}}>
          <SectionHead num="01" title="Категории расходов"/>
          {CATEGORIES.map((c,i)=><div key={c} style={{background:i%2===0?C.white:C.lightGray,padding:"9px 14px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontFamily:FONT,fontSize:13,color:C.dark}}>{c}</span><span style={{color:C.cherryM,fontSize:11,cursor:"pointer"}}>✎</span></div>)}
          <div style={{marginTop:12}}><Btn>+ Добавить категорию</Btn></div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [page,setPage]=useState("svodka");
  const [receipts,setReceipts]=useState(INITIAL_RECEIPTS);
  const NAV=[{id:"svodka",icon:"▦",label:"Сводка"},{id:"operacii",icon:"≡",label:"Операции"},{id:"otchety",icon:"▤",label:"Отчёты"},{id:"nastroyki",icon:"⚙",label:"Настройки"}];
  const PT={svodka:"Сводка",operacii:"Операции",otchety:"Отчёты",nastroyki:"Настройки"};
  return (
    <div style={{maxWidth:480,margin:"0 auto",height:"100vh",display:"flex",flexDirection:"column",background:C.light,fontFamily:FONT,overflow:"hidden"}}>
      <div style={{background:C.white,borderBottom:`2px solid ${C.cherry}`,flexShrink:0}}>
        <div style={{padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <img src="data:image/png;base64,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/tXtP2bKoNzZOz8V1eWOjWaYa/7qvRn49c++UK0zad7TMzPbLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==" alt="AOCG" style={{width:40,height:40,objectFit:"contain",background:"transparent",flexShrink:0}}/>
            <div>
              <div style={{lineHeight:1.1}}>
                <span style={{fontSize:13,fontFamily:FONT,color:C.gray,letterSpacing:"0.08em"}}>AOCG </span>
                <span style={{fontSize:13,fontFamily:FONT,color:C.dark,letterSpacing:"0.08em",fontWeight:700}}>AI </span>
                <span style={{fontSize:13,fontFamily:FONT,color:C.cherry,letterSpacing:"0.08em",fontWeight:700}}>Квит</span>
              </div>
              <div style={{fontSize:8,letterSpacing:"0.22em",textTransform:"uppercase",color:C.grayL}}>Первичные документы</div>
            </div>
          </div>
          <div style={{width:30,height:30,background:C.lightGray,border:`1px solid ${C.silver}`,color:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:10,fontWeight:700}}>АШ</div>
        </div>
        <div style={{padding:"4px 16px 8px",display:"flex",alignItems:"center",gap:8,borderTop:`1px solid ${C.silver}`}}>
          <div style={{width:2,height:12,background:C.cherryM}}/><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>{PT[page]}</span><div style={{flex:1,height:"0.5px",background:C.silver}}/>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {page==="svodka"&&<SvodkaPage receipts={receipts}/>}
        {page==="operacii"&&<OperaciiPage receipts={receipts} setReceipts={setReceipts}/>}
        {page==="otchety"&&<OtchetyPage receipts={receipts} setReceipts={setReceipts}/>}
        {page==="nastroyki"&&<NastroykiPage/>}
      </div>
      <div style={{background:C.white,borderTop:`1px solid ${C.silver}`,display:"flex",flexShrink:0}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setPage(n.id)} style={{flex:1,padding:"9px 0",border:"none",background:page===n.id?C.cherryL:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",borderTop:page===n.id?`2px solid ${C.cherry}`:"2px solid transparent",transition:"all 0.15s",borderRight:`1px solid ${C.silver}`}}>
            <span style={{fontSize:15,color:page===n.id?C.cherry:C.grayL}}>{n.icon}</span>
            <span style={{fontSize:8,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:FONT,color:page===n.id?C.cherry:C.grayL}}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
