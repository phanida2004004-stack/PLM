import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import './styles.css';
import App from './App';
class ErrorBoundary extends React.Component {state={error:false};static getDerivedStateFromError(){return {error:true};}render(){return this.state.error?<div style={{padding:40,fontFamily:'sans-serif'}}><h1>แสดงหน้าเว็บไม่สำเร็จ</h1><p>ลองรีโหลดหน้าเว็บ หากยังพบปัญหาให้เก็บข้อความ Error ใน Console เพื่อตรวจสอบ</p><button onClick={()=>location.reload()}>โหลดใหม่</button></div>:this.props.children;}}
createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);
