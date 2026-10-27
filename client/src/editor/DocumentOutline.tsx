import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

export function DocumentOutline({editor,onClose}:{editor:Editor;onClose:()=>void}) {
  const [,refresh]=useState(0);
  useEffect(()=>{const update=()=>refresh(v=>v+1);editor.on('update',update);return()=>{editor.off('update',update);};},[editor]);
  const headings:{text:string;position:number;level:number}[]=[];
  editor.state.doc.descendants((node,position)=>{if(node.type.name==='heading')headings.push({text:node.textContent,position,level:node.attrs.level});});
  return <aside className="document-outline no-print" aria-label="제목 탐색">
    <div className="panel-heading"><strong>문서 탐색</strong><button onClick={onClose} aria-label="문서 탐색 닫기">닫기</button></div>
    {!headings.length && <p>제목 스타일을 적용하면 여기에 표시됩니다.</p>}
    {headings.map(heading=><button key={heading.position} style={{paddingLeft:8+(heading.level-1)*12}} title={heading.text} onClick={()=>{if(!editor.view.composing)editor.chain().focus().setTextSelection(heading.position+1).scrollIntoView().run();}}>{heading.text || '(빈 제목)'}</button>)}
  </aside>;
}
