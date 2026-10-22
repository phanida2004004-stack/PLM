(function(root){
  function resolveByPO(rows){
    const ignored=new Set(['ICT','PLASTIC','EMPTY']);
    const clean=v=>String(v||'').trim();
    const valid=v=>clean(v)&&!ignored.has(clean(v).toUpperCase());
    const groups=new Map();
    for(const row of rows){
      if(!row.bomFound){row.brand='';continue;}
      row.brandCandidates=[...new Set((row.brandCandidates||[]).map(clean).filter(valid))];
      if(!row.sapPo)continue;
      if(!groups.has(row.sapPo))groups.set(row.sapPo,[]);groups.get(row.sapPo).push(row);
    }
    for(const group of groups.values()){
      const trusted=group.filter(r=>['MANUAL','CONFIRMED'].includes(r.brandSource)&&r.verified&&valid(r.originalBrand));
      const anchors=[...new Set((trusted.length?trusted:group).map(r=>clean(r.originalBrand)).filter(valid))];
      let selected=anchors.length===1?anchors[0]:'';
      if(!anchors.length){
        const sets=group.map(r=>r.brandCandidates).filter(s=>s.length);
        const common=sets.length?sets[0].filter(v=>sets.every(s=>s.includes(v))):[];
        if(common.length===1)selected=common[0];
      }
      for(const row of group){
        if(selected){
          if(clean(row.brand)!==selected){row.brand=selected;row.brandSource='SAP_PO_FALLBACK';}
          row.conflict=false;
        }else{
          const candidates=[...new Set(group.flatMap(r=>[r.originalBrand,...r.brandCandidates]).filter(valid))];
          row.brand='';row.conflict=candidates.length>1;row.brandSource=row.conflict?'CONFLICT':'UNRESOLVED';
          row.brandCandidates=candidates;
        }
      }
    }
    return rows;
  }
  if(typeof module!=='undefined')module.exports={resolveByPO};
  root.PLBrandRules={resolveByPO};
})(typeof window==='undefined'?globalThis:window);
