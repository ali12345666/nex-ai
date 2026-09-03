import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Clock, FolderOpen, Trash2 } from 'lucide-react';

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export default function RecentProjects() {
  const { setProjectPath } = useStore();
  const [projects, setProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    loadRecent();
  }, []);

  const loadRecent = async () => {
    const stored = await window.nexAPI.configGet('recentProjects');
    if (Array.isArray(stored)) setProjects(stored.slice(0, 10));
  };

  const addProject = async (path: string) => {
    const name = path.split(/[\\/]/).pop() || path;
    const existing = projects.filter((p) => p.path !== path);
    const updated = [{ path, name, lastOpened: Date.now() }, ...existing].slice(0, 10);
    setProjects(updated);
    await window.nexAPI.configSet('recentProjects', updated);
  };

  const removeProject = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = projects.filter((p) => p.path !== path);
    setProjects(updated);
    await window.nexAPI.configSet('recentProjects', updated);
  };

  const openProject = (path: string) => {
    setProjectPath(path);
    addProject(path);
  };

  // Expose addProject globally for other components
  (window as any).__recentProjectsAdd = addProject;

  if (projects.length === 0) return null;

  return (
    <div className="mt-8 animate-in">
      <h3 className="text-sm font-semibold text-nex-text-dim mb-3 flex items-center gap-2">
        <Clock size={14} />
        Recent Projects
      </h3>
      <div className="space-y-1 max-w-md mx-auto">
        {projects.map((project) => (
          <button key={project.path} onClick={() => openProject(project.path)}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left hover:bg-nex-card border border-transparent hover:border-nex-border transition-all group">
            <FolderOpen size={16} className="text-nex-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-nex-text truncate">{project.name}</div>
              <div className="text-[11px] text-nex-text-muted truncate">{project.path}</div>
            </div>
            <span className="text-[10px] text-nex-text-muted shrink-0">{new Date(project.lastOpened).toLocaleDateString()}</span>
            <button onClick={(e) => removeProject(project.path, e)}
              className="opacity-0 group-hover:opacity-100 text-nex-text-dim hover:text-nex-error transition-all shrink-0">
              <Trash2 size={12} />
            </button>
          </button>
        ))}
      </div>
    </div>
  );
}
