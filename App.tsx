
import React, { useState, useEffect, useRef } from 'react';
import { User, UserRole, ContentProject, ContentStatus, ContentType, ProjectLog } from './types';
import { MOCK_USERS, STATUS_COLORS, GLOSSARY } from './constants';
import { generateInitialContextQuestions, generateFinalContent } from './geminiService';
import { loadProjects, saveProjects } from './indexedDb';

const LoadingOverlay: React.FC<{ message: string }> = ({ message }) => (
  <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
    <div className="bg-white p-8 rounded-[40px] shadow-2xl flex flex-col items-center gap-6 max-w-sm w-full text-center">
      <div className="relative">
        <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center text-2xl">🤖</div>
      </div>
      <div>
        <h3 className="text-xl font-black text-slate-800 mb-2 tracking-tighter">Procesando...</h3>
        <p className="text-slate-500 font-bold text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(MOCK_USERS[4]); 
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'my-tasks' | 'repository' | 'glossary' | 'logs'>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  const [newType, setNewType] = useState<ContentType>(ContentType.IMAGEN);
  const [newPrompt, setNewPrompt] = useState('');
  const [aiQuestions, setAiQuestions] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  
  const [textCreationMode, setTextCreationMode] = useState<'scratch' | 'repo'>('scratch');
  const [selectedRefImage, setSelectedRefImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeProjectForCreation, setActiveProjectForCreation] = useState<ContentProject | null>(null);

  const [contextData, setContextData] = useState({
    objective: '',
    audience: '',
    toneAndStyle: '',
    restrictions: ''
  });

  // Carga inicial de proyectos desde IndexedDB
  useEffect(() => {
    loadProjects().then(savedProjects => {
      if (savedProjects && savedProjects.length > 0) {
        setProjects(savedProjects);
      }
    });
  }, []);

  // Guardado automático en IndexedDB con debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (projects.length > 0) {
        saveProjects(projects);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [projects]);

  useEffect(() => {
    if (currentUser.role === UserRole.EDITOR) {
      setNewType(ContentType.TEXTO);
    } else {
      setNewType(ContentType.IMAGEN);
    }
  }, [currentUser]);

  const handleUserChange = (userId: string) => {
    const user = MOCK_USERS.find(u => u.id === userId);
    setCurrentUser(user);
    // Restaurar seguridad: Siempre pedir PIN al cambiar de perfil
    setIsAuthenticated(false);
    setPinInput('');
    setPinError(false);
    setShowProfileMenu(false);
    resetForm();
    setIsCreating(false);
    setActiveProjectForCreation(null);
  };

  const verifyPin = () => {
    if (pinInput === currentUser.pin) {
      setIsAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedRefImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStartCreation = async () => {
    if (!newPrompt.trim()) return;
    
    if (currentUser.role === UserRole.MARKETING_LEAD) {
      setLoading(true);
      setLoadingMessage('Asignando pedido...');
      setTimeout(() => {
        const assignedTo = newType === ContentType.IMAGEN ? MOCK_USERS[0].id : MOCK_USERS[2].id;
        const newProjectId = Math.random().toString(36).substr(2, 9);
        const newOrder: ContentProject = {
          id: newProjectId,
          title: `Pedido: ${newType}`,
          type: newType,
          status: ContentStatus.INICIADO,
          creatorId: assignedTo,
          prompt: newPrompt,
          updatedAt: Date.now(),
          logs: [{
            timestamp: Date.now(),
            userId: currentUser.id,
            userName: currentUser.name,
            action: 'Creó pedido de marketing',
            details: `Prompt: ${newPrompt}`
          }]
        };
        setProjects([newOrder, ...projects]);
        setIsCreating(false);
        resetForm();
        setLoading(false);
      }, 800);
      return;
    }

    setLoading(true);
    setLoadingMessage('Consultando a la IA...');
    try {
      let qs = await generateInitialContextQuestions(newPrompt, newType);
      setAiQuestions(qs || 'Complete el contexto.');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeCreation = async () => {
    setLoading(true);
    setLoadingMessage('La IA está trabajando en tu propuesta...');
    try {
      const simplifiedContext = {
        objective: contextData.objective,
        audience: contextData.audience,
        tone: contextData.toneAndStyle,
        style: contextData.toneAndStyle,
        restrictions: contextData.restrictions
      };
      
      const targetPrompt = newPrompt;
      const targetType = newType;
      
      const result = await generateFinalContent(targetPrompt, targetType, simplifiedContext, selectedRefImage || undefined);
      
      if (activeProjectForCreation) {
        setProjects(prev => prev.map(p => {
          if (p.id === activeProjectForCreation.id) {
            const updated = {
              ...p,
              prompt: targetPrompt, // Guardamos el prompt modificado por el usuario
              status: ContentStatus.EN_EDICION,
              iterations: 3,
              context: simplifiedContext,
              output: result || '',
              updatedAt: Date.now()
            };
            const log: ProjectLog = {
              timestamp: Date.now(),
              userId: currentUser.id,
              userName: currentUser.name,
              action: 'Generó contenido desde pedido',
              details: `Prompt final: ${targetPrompt}`
            };
            updated.logs = [log, ...p.logs];
            return updated;
          }
          return p;
        }));
        setActiveProjectForCreation(null);
      } else {
        const newProjectId = Math.random().toString(36).substr(2, 9);
        const newProject: ContentProject = {
          id: newProjectId,
          title: `Contenido: ${newType}`,
          type: newType,
          status: ContentStatus.EN_EDICION,
          creatorId: currentUser.id,
          prompt: newPrompt,
          iterations: 3,
          context: simplifiedContext,
          output: result || '',
          updatedAt: Date.now(),
          logs: [{
            timestamp: Date.now(),
            userId: currentUser.id,
            userName: currentUser.name,
            action: 'Inició creación propia',
            details: `Prompt: ${newPrompt}`
          }]
        };
        setProjects([newProject, ...projects]);
      }
      setIsCreating(false);
      resetForm();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleIterateImage = async (projectId: string, editPrompt: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project || (project.iterations || 0) <= 0) return;
    setLoading(true);
    setLoadingMessage('Aplicando ajustes...');
    try {
      const result = await generateFinalContent(`${project.prompt}. Modificación: ${editPrompt}`, project.type, project.context);
      setProjects(prev => prev.map(p => {
        if (p.id === projectId) {
          const newIterations = (p.iterations || 0) - 1;
          const newProject = { ...p, output: result || p.output, iterations: newIterations, updatedAt: Date.now() };
          const log: ProjectLog = {
            timestamp: Date.now(),
            userId: currentUser.id,
            userName: currentUser.name,
            action: 'Ajustó con IA',
            details: `Instrucción: ${editPrompt}`
          };
          newProject.logs = [log, ...p.logs];
          return newProject;
        }
        return p;
      }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setNewPrompt('');
    setAiQuestions(null);
    setContextData({ objective: '', audience: '', toneAndStyle: '', restrictions: '' });
    setSelectedRefImage(null);
    setTextCreationMode('scratch');
  };

  const updateStatus = (id: string, newStatus: ContentStatus, comments?: string) => {
    if (newStatus === ContentStatus.EN_EDICION) {
      const p = projects.find(proj => proj.id === id);
      if (p && p.status === ContentStatus.INICIADO) {
        setNewPrompt(p.prompt);
        setNewType(p.type);
        setActiveProjectForCreation(p);
        setIsCreating(true);
        return;
      }
    }
    setLoading(true);
    setLoadingMessage(`Cambiando a ${newStatus}...`);
    setTimeout(() => {
      setProjects(prev => prev.map(p => {
        if (p.id === id) {
          const resetIterations = (newStatus === ContentStatus.DEVUELTO) ? 3 : p.iterations;
          const updatedProject = { 
            ...p, 
            status: newStatus, 
            reviewerComments: comments || p.reviewerComments, 
            iterations: resetIterations,
            updatedAt: Date.now() 
          };
          const log: ProjectLog = {
            timestamp: Date.now(),
            userId: currentUser.id,
            userName: currentUser.name,
            action: `Cambio de estado: ${newStatus}`,
            details: comments
          };
          updatedProject.logs = [log, ...p.logs];
          return updatedProject;
        }
        return p;
      }));
      setLoading(false);
    }, 600);
  };

  const approvedImages = projects.filter(p => p.type === ContentType.IMAGEN && p.status === ContentStatus.APROBADO);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {loading && <LoadingOverlay message={loadingMessage} />}
      
      {zoomedImage && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 md:p-12 cursor-zoom-out" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" alt="Zoomed" />
        </div>
      )}

      <header className="bg-white border-b sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl">📢</div>
          <h1 className="text-xl font-black text-slate-800 tracking-tighter">Espacio Co-Creativo | <span className="text-indigo-600 font-bold">Marketing</span></h1>
        </div>
        
        <div className="relative">
          <button onClick={() => setShowProfileMenu(!showProfileMenu)} className="flex items-center gap-3 text-right hover:bg-slate-50 p-2 rounded-2xl transition-all">
            <div className="hidden sm:block">
              <p className="text-sm font-black text-slate-800 leading-none">{currentUser.name}</p>
              <p className="text-[10px] uppercase tracking-widest font-black text-indigo-400 mt-1">{currentUser.role}</p>
            </div>
            <span className="text-2xl">🚪</span>
          </button>
          
          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-100 rounded-3xl shadow-2xl p-4 z-40 animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 mb-3">Cambiar Perfil</p>
              <div className="space-y-1">
                {MOCK_USERS.map(u => (
                  <button key={u.id} onClick={() => handleUserChange(u.id)} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${u.id === currentUser.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {u.name} <span className="text-[9px] opacity-60 font-medium block">{u.role}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-50">
                <button onClick={() => setIsAuthenticated(false)} className="w-full py-3 bg-red-50 text-red-500 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-100 transition-all">Cerrar Sesión</button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row">
        <aside className="w-full md:w-64 bg-white border-r p-4 flex flex-col gap-2">
          {/* Botón de creación en la parte superior para visibilidad inmediata */}
          <div className="mb-6">
            <button onClick={() => { setIsCreating(true); setActiveProjectForCreation(null); resetForm(); }} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg hover:bg-indigo-700 transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-2">
              <span className="text-lg">+</span> {currentUser.role === UserRole.MARKETING_LEAD ? 'Nuevo Pedido' : 'Crear Pieza'}
            </button>
          </div>

          <button onClick={() => { setActiveTab('all'); setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'all' && !isCreating ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>Proyectos</button>
          <button onClick={() => { setActiveTab('my-tasks'); setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'my-tasks' && !isCreating ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>Mis Tareas</button>
          <button onClick={() => { setActiveTab('repository'); setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'repository' && !isCreating ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>Archivo</button>
          <button onClick={() => { setActiveTab('logs'); setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'logs' && !isCreating ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>Actividad</button>
          <button onClick={() => { setActiveTab('glossary'); setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'glossary' && !isCreating ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>Glosario</button>
        </aside>

        <section className="flex-1 p-4 md:p-8 overflow-y-auto">
          {activeTab === 'logs' ? (
             <div className="max-w-5xl mx-auto space-y-6">
               <h2 className="text-2xl font-black text-slate-800 mb-8 tracking-tighter">Registro de Actividad</h2>
               <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
                 <table className="w-full text-left">
                   <thead>
                     <tr className="bg-slate-50 border-b border-slate-100">
                       <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Hora</th>
                       <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuario</th>
                       <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Acción</th>
                       <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Detalles</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50">
                     {projects.flatMap(p => p.logs.map(l => ({ ...l, pId: p.id }))).sort((a, b) => b.timestamp - a.timestamp).map((log, idx) => (
                       <tr key={idx} className="hover:bg-slate-50 transition-all">
                         <td className="px-6 py-4 text-[10px] font-mono text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                         <td className="px-6 py-4 font-black text-xs text-slate-800">{log.userName}</td>
                         <td className="px-6 py-4 font-bold text-xs text-indigo-600">{log.action}</td>
                         <td className="px-6 py-4 text-[11px] text-slate-500 italic max-w-xs truncate">{log.details || '-'}</td>
                       </tr>
                     ))}
                     {projects.length === 0 && (
                       <tr><td colSpan={4} className="px-6 py-20 text-center font-bold text-slate-300">Sin movimientos registrados.</td></tr>
                     )}
                   </tbody>
                 </table>
               </div>
             </div>
          ) : activeTab === 'glossary' ? (
            <div className="max-w-2xl mx-auto space-y-6">
              <h2 className="text-2xl font-black text-slate-800 mb-8 tracking-tighter">Glosario de Estados</h2>
              {GLOSSARY.map((g, i) => (
                <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 flex items-start gap-4 shadow-sm">
                  <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border-2 shrink-0 ${g.color || STATUS_COLORS[g.status as any] || 'bg-slate-100 text-slate-500'}`}>{g.status}</span>
                  <p className="text-sm font-bold text-slate-600 leading-relaxed">{g.desc}</p>
                </div>
              ))}
            </div>
          ) : isCreating ? (
            <div className="max-w-2xl mx-auto bg-white p-8 rounded-[40px] shadow-xl border border-slate-100 animate-in slide-in-from-bottom-8 duration-300">
              <div className="flex items-center gap-4 mb-8">
                <button onClick={() => { setIsCreating(false); setActiveProjectForCreation(null); resetForm(); }} className="text-slate-400 hover:text-slate-600 text-2xl font-black">×</button>
                <h2 className="text-2xl font-black tracking-tighter">
                  {activeProjectForCreation ? `Atendiendo pedido` : (currentUser.role === UserRole.MARKETING_LEAD ? 'Nuevo Pedido' : 'Nueva Pieza')}
                </h2>
              </div>

              {!aiQuestions || currentUser.role === UserRole.MARKETING_LEAD ? (
                <div className="space-y-8">
                   <div className="flex gap-4">
                      <button 
                        disabled={currentUser.role === UserRole.EDITOR || (!!activeProjectForCreation && activeProjectForCreation.type === ContentType.TEXTO)}
                        onClick={() => setNewType(ContentType.IMAGEN)} 
                        className={`flex-1 py-6 border-2 rounded-3xl transition-all flex flex-col items-center gap-3 ${newType === ContentType.IMAGEN ? 'border-indigo-600 bg-indigo-50' : 'border-slate-50 bg-slate-50/50'} ${currentUser.role === UserRole.EDITOR || (!!activeProjectForCreation && activeProjectForCreation.type === ContentType.TEXTO) ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                      >
                        <span className="text-4xl">🖼️</span>
                        <span className="font-black text-xs uppercase tracking-widest">Imagen</span>
                      </button>
                      <button 
                        disabled={currentUser.role === UserRole.DISENADOR || (!!activeProjectForCreation && activeProjectForCreation.type === ContentType.IMAGEN)}
                        onClick={() => setNewType(ContentType.TEXTO)} 
                        className={`flex-1 py-6 border-2 rounded-3xl transition-all flex flex-col items-center gap-3 ${newType === ContentType.TEXTO ? 'border-indigo-600 bg-indigo-50' : 'border-slate-50 bg-slate-50/50'} ${currentUser.role === UserRole.DISENADOR || (!!activeProjectForCreation && activeProjectForCreation.type === ContentType.IMAGEN) ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                      >
                        <span className="text-4xl">✍️</span>
                        <span className="font-black text-xs uppercase tracking-widest">Texto</span>
                      </button>
                    </div>

                  {newType === ContentType.TEXTO && currentUser.role !== UserRole.MARKETING_LEAD && (
                    <div className="bg-slate-50 p-6 rounded-[32px] border-2 border-slate-100 space-y-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">¿Cómo deseas generar el texto?</p>
                      <div className="flex gap-2">
                        <button onClick={() => { setTextCreationMode('scratch'); setSelectedRefImage(null); }} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${textCreationMode === 'scratch' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200'}`}>De cero</button>
                        <button onClick={() => setTextCreationMode('repo')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${textCreationMode === 'repo' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200'}`}>Desde Repositorio</button>
                      </div>
                      
                      {textCreationMode === 'scratch' && (
                        <div className="pt-2">
                           <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                           <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline px-1">
                              {selectedRefImage ? '✅ Imagen Adjunta' : '📎 Adjuntar Imagen (Opcional)'}
                           </button>
                        </div>
                      )}

                      {textCreationMode === 'repo' && (
                        <div className="grid grid-cols-4 gap-2 pt-2">
                          {approvedImages.map(img => (
                            <button key={img.id} onClick={() => setSelectedRefImage(img.output || null)} className={`aspect-square rounded-xl overflow-hidden border-4 transition-all ${selectedRefImage === img.output ? 'border-indigo-600 scale-95 shadow-lg' : 'border-transparent'}`}>
                              <img src={img.output} className="w-full h-full object-cover" />
                            </button>
                          ))}
                          {approvedImages.length === 0 && <p className="col-span-4 text-[10px] text-slate-400 font-bold py-2 text-center">No hay imágenes aprobadas aún.</p>}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 px-1">Instrucciones</label>
                    <textarea 
                      className="w-full p-6 border-2 border-slate-100 bg-white rounded-3xl focus:border-indigo-500 outline-none h-40 transition-all font-medium text-slate-700" 
                      placeholder={textCreationMode === 'repo' ? "Describe el copy que quieres para esta imagen..." : "Describe lo que buscas..."} 
                      value={newPrompt} 
                      onChange={(e) => setNewPrompt(e.target.value)} 
                    />
                  </div>
                  <button disabled={loading || !newPrompt || (textCreationMode === 'repo' && !selectedRefImage)} onClick={handleStartCreation} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 disabled:bg-slate-200 transition-all uppercase tracking-widest shadow-xl">
                    Continuar con IA
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {selectedRefImage && (
                    <div className="flex items-center gap-4 bg-indigo-50 p-4 rounded-3xl border border-indigo-100">
                      <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-white">
                        <img src={selectedRefImage} className="w-full h-full object-cover" />
                      </div>
                      <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Referencia visual activada 👁️</p>
                    </div>
                  )}
                  <div className="bg-indigo-600 p-6 rounded-[32px] text-white shadow-lg">
                    <h3 className="font-black mb-4 text-xs uppercase tracking-widest opacity-80">🤖 Contexto Necesario:</h3>
                    <div className="font-bold text-sm leading-relaxed space-y-3">
                      {aiQuestions.split('\n').map((line, i) => <p key={i}>{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>)}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <input className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none transition-all text-sm font-bold" placeholder="Objetivo..." value={contextData.objective} onChange={(e) => setContextData({...contextData, objective: e.target.value})} />
                      <input className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none transition-all text-sm font-bold" placeholder="Audiencia..." value={contextData.audience} onChange={(e) => setContextData({...contextData, audience: e.target.value})} />
                    </div>
                    <input className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none transition-all text-sm font-bold" placeholder="Tono/Estilo..." value={contextData.toneAndStyle} onChange={(e) => setContextData({...contextData, toneAndStyle: e.target.value})} />
                    <textarea className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none h-24 text-sm font-bold" placeholder="Limitaciones..." value={contextData.restrictions} onChange={(e) => setContextData({...contextData, restrictions: e.target.value})} />
                  </div>
                  <button disabled={loading} onClick={handleFinalizeCreation} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 transition-all uppercase shadow-xl tracking-widest">Generar Propuesta</button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              {projects.filter(p => {
                const isLead = currentUser.role === UserRole.MARKETING_LEAD;
                if (activeTab === 'repository') return p.status === ContentStatus.APROBADO;
                if (activeTab === 'my-tasks') {
                   if (isLead) return p.status === ContentStatus.EN_REVISION;
                   return p.creatorId === currentUser.id && (p.status === ContentStatus.INICIADO || p.status === ContentStatus.EN_EDICION || p.status === ContentStatus.DEVUELTO);
                }
                if (isLead) return p.status !== ContentStatus.APROBADO && p.status !== ContentStatus.EN_REVISION;
                return p.status !== ContentStatus.APROBADO && p.status !== ContentStatus.INICIADO && p.status !== ContentStatus.DEVUELTO;
              }).map(project => (
                <ProjectCard key={project.id} project={project} user={currentUser} onUpdateStatus={updateStatus} onZoom={(img) => setZoomedImage(img)} onIterate={handleIterateImage} loading={loading} />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* LOGIN MODAL SIEMPRE QUE NO ESTÉ AUTENTICADO */}
      {!isAuthenticated && (
        <div className="fixed inset-0 z-[200] bg-slate-900/90 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-md text-center animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-3xl mx-auto mb-6 shadow-xl">🔐</div>
            <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tighter">Confirmar Identidad</h2>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-8">Ingresa el PIN de {currentUser.name}</p>
            <div className="space-y-6 text-left">
              <div>
                <input type="password" maxLength={4} className={`w-full text-center text-3xl tracking-[0.5em] p-4 border-2 rounded-2xl focus:ring-4 focus:ring-indigo-100 outline-none font-mono transition-all ${pinError ? 'border-red-500 bg-red-50' : 'border-slate-100 bg-white'}`} placeholder="****" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} onKeyUp={(e) => e.key === 'Enter' && verifyPin()} autoFocus />
                {pinError && <p className="text-red-500 text-[10px] font-black uppercase text-center mt-3 tracking-widest">PIN Incorrecto</p>}
              </div>
              <button onClick={verifyPin} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 transition-all shadow-xl uppercase tracking-widest">Entrar</button>
              <button onClick={() => setShowProfileMenu(true)} className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">¿No eres {currentUser.name}? Cambiar Perfil</button>
            </div>
          </div>
          
          {/* Menu de perfiles dentro del login para cambiar si se equivocó */}
          {showProfileMenu && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white p-6 rounded-[32px] shadow-2xl w-full max-w-sm border border-slate-100">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Seleccionar otro perfil</p>
                 <div className="space-y-2">
                    {MOCK_USERS.map(u => (
                      <button key={u.id} onClick={() => handleUserChange(u.id)} className="w-full text-left px-4 py-3 rounded-xl text-xs font-black bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                        {u.name} — {u.role}
                      </button>
                    ))}
                 </div>
               </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ProjectCard: React.FC<{ project: ContentProject, user: User, onUpdateStatus: (id: string, s: ContentStatus, c?: string) => void, onZoom: (img: string) => void, onIterate: (id: string, prompt: string) => void, loading: boolean }> = ({ project, user, onUpdateStatus, onZoom, onIterate, loading }) => {
  const [comment, setComment] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const isReviewer = user.role === UserRole.MARKETING_LEAD;
  const isCreator = user.id === project.creatorId;
  const lastModifier = MOCK_USERS.find(u => u.id === project.creatorId);

  return (
    <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full overflow-hidden relative">
      <div className="flex justify-between items-start mb-6">
        <div>
          <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase border-2 mb-3 inline-block tracking-widest ${STATUS_COLORS[project.status]}`}>{project.status}</span>
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Responsable: <span className="text-slate-800">{lastModifier?.name}</span></p>
          <h3 className="text-lg font-black text-slate-800 leading-tight tracking-tighter">Tipo de contenido: {project.type}</h3>
        </div>
      </div>

      {project.status === ContentStatus.INICIADO ? (
        <div className="bg-indigo-50 p-6 rounded-[28px] mb-6 border-2 border-indigo-100/50 flex-1 flex flex-col justify-center text-center">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">📥 Brief de Matías:</p>
          <p className="text-sm font-bold text-slate-700 italic">"{project.prompt}"</p>
          <button onClick={() => onUpdateStatus(project.id, ContentStatus.EN_EDICION)} className="mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all shadow-md">Atender Pedido</button>
        </div>
      ) : (
        <div className="relative bg-slate-50 rounded-[28px] mb-6 border-4 border-slate-50 flex items-center justify-center overflow-hidden h-[400px]">
          {project.type === ContentType.IMAGEN ? (
            <img src={project.output} className="w-full h-full object-cover cursor-zoom-in" alt="Output" onClick={() => onZoom(project.output!)} />
          ) : (
            /* SCROLL HABILITADO PARA TEXTO LARGO */
            <div className="w-full h-full p-8 text-sm text-slate-600 font-bold italic leading-relaxed text-center overflow-y-auto whitespace-pre-wrap custom-scrollbar">
              {project.output}
            </div>
          )}
        </div>
      )}

      {isCreator && (project.status === ContentStatus.EN_EDICION || project.status === ContentStatus.DEVUELTO) && project.output && (
        <div className="bg-slate-50 p-4 rounded-2xl mb-6 border-2 border-slate-100">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-1">Ajustes IA ({project.iterations} restantes)</p>
           {project.iterations! > 0 ? (
             <div className="flex gap-2">
               <input className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none" placeholder="Modificar..." value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} />
               <button disabled={loading || !editPrompt} onClick={() => { onIterate(project.id, editPrompt); setEditPrompt(''); }} className="bg-indigo-600 text-white px-4 rounded-xl text-[10px] font-black uppercase">Ajustar</button>
             </div>
           ) : <p className="text-[10px] text-red-400 font-black uppercase text-center py-2">Sin intentos</p>}
        </div>
      )}

      <div className="mt-auto space-y-4 pt-6 border-t">
        {project.reviewerComments && project.status !== ContentStatus.APROBADO && (
          <div className="bg-amber-50 p-4 rounded-2xl border-l-4 border-amber-400">
            <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1 px-1">Feedback de Matías:</p>
            <p className="text-xs text-amber-900 font-bold">"{project.reviewerComments}"</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {isCreator && (project.status === ContentStatus.EN_EDICION || project.status === ContentStatus.DEVUELTO) && (
            <div className="flex gap-2">
              <button disabled={!project.output} onClick={() => onUpdateStatus(project.id, ContentStatus.EN_REVISION)} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg disabled:opacity-50">Enviar Revisión 🚀</button>
              <button onClick={() => onUpdateStatus(project.id, ContentStatus.CANCELADO)} className="px-4 bg-slate-100 text-slate-400 rounded-2xl text-[10px] font-black uppercase">Descartar</button>
            </div>
          )}

          {isReviewer && project.status === ContentStatus.EN_REVISION && (
            <div className="space-y-4">
              <textarea className="w-full p-4 text-xs border-2 border-slate-100 rounded-2xl bg-slate-50 focus:bg-white outline-none font-bold" placeholder="Escribe tu veredicto..." value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => onUpdateStatus(project.id, ContentStatus.APROBADO, comment)} className="bg-emerald-600 text-white py-3 rounded-xl text-[9px] font-black uppercase hover:bg-emerald-700">Aprobar</button>
                <button onClick={() => onUpdateStatus(project.id, ContentStatus.DEVUELTO, comment)} className="bg-amber-500 text-white py-3 rounded-xl text-[9px] font-black uppercase hover:bg-amber-600">Devolver</button>
                <button onClick={() => onUpdateStatus(project.id, ContentStatus.RECHAZADO, comment)} className="bg-red-600 text-white py-3 rounded-xl text-[9px] font-black uppercase hover:bg-red-700">Rechazar</button>
              </div>
            </div>
          )}

          {project.status === ContentStatus.APROBADO && <div className="bg-emerald-50 py-3 rounded-2xl text-emerald-700 text-[10px] font-black uppercase text-center border tracking-widest">🌟 ARCHIVADO</div>}
          {project.status === ContentStatus.RECHAZADO && <div className="bg-red-50 py-3 rounded-2xl text-red-700 text-[10px] font-black uppercase text-center border tracking-widest">❌ RECHAZADO</div>}
        </div>
      </div>
    </div>
  );
};

export default App;
