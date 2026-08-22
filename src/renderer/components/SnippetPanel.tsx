import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Code2, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';

interface Snippet {
  name: string;
  language: string;
  code: string;
  description: string;
}

interface SnippetCategory {
  name: string;
  snippets: Snippet[];
}

const SNIPPET_CATEGORIES: SnippetCategory[] = [
  {
    name: 'React',
    snippets: [
      { name: 'Functional Component', language: 'typescript', description: 'React functional component with props', code: `import React from 'react';\n\ninterface Props {\n  title: string;\n}\n\nexport function MyComponent({ title }: Props) {\n  return (\n    <div>\n      <h1>{title}</h1>\n    </div>\n  );\n}` },
      { name: 'useState Hook', language: 'typescript', description: 'React useState hook template', code: `const [state, setState] = useState<Type>(initialValue);` },
      { name: 'useEffect Hook', language: 'typescript', description: 'React useEffect with cleanup', code: `useEffect(() => {\n  // effect\n  return () => {\n    // cleanup\n  };\n}, [deps]);` },
      { name: 'API Fetch', language: 'typescript', description: 'Fetch API with error handling', code: `const fetchData = async () => {\n  try {\n    const response = await fetch(url);\n    const data = await response.json();\n    return data;\n  } catch (error) {\n    console.error('Error:', error);\n  }\n};` },
    ],
  },
  {
    name: 'Node.js',
    snippets: [
      { name: 'Express Server', language: 'javascript', description: 'Basic Express server setup', code: `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello World' });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});` },
      { name: 'REST Endpoint', language: 'javascript', description: 'CRUD endpoint template', code: `app.get('/api/items', async (req, res) => {\n  try {\n    const items = await Item.find();\n    res.json(items);\n  } catch (error) {\n    res.status(500).json({ error: error.message });\n  }\n});` },
    ],
  },
  {
    name: 'Python',
    snippets: [
      { name: 'FastAPI Endpoint', language: 'python', description: 'FastAPI route handler', code: `from fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Item(BaseModel):\n    name: str\n    price: float\n\n@app.post("/items/")\nasync def create_item(item: Item):\n    return {"item": item}` },
      { name: 'Class', language: 'python', description: 'Python class with init', code: `class MyClass:\n    def __init__(self, name: str):\n        self.name = name\n    \n    def method(self) -> str:\n        return f"Hello, {self.name}"` },
    ],
  },
  {
    name: 'Database',
    snippets: [
      { name: 'SQL Create Table', language: 'sql', description: 'SQL table creation', code: `CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);` },
    ],
  },
  {
    name: 'TypeScript',
    snippets: [
      { name: 'Interface', language: 'typescript', description: 'TypeScript interface definition', code: `interface User {\n  id: string;\n  name: string;\n  email: string;\n  role: 'admin' | 'user' | 'guest';\n  createdAt: Date;\n}` },
      { name: 'Enum', language: 'typescript', description: 'TypeScript enum', code: `enum Status {\n  Active = 'ACTIVE',\n  Inactive = 'INACTIVE',\n  Pending = 'PENDING',\n}` },
    ],
  },
];

export default function SnippetPanel() {
  const [expandedCategory, setExpandedCategory] = useState<string | null>('React');
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);

  const handleCopy = (code: string, key: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIdx(key);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleInsert = (snippet: Snippet) => {
    // Insert into active editor if available
    const editor = (window as any).__monacoEditor;
    if (editor) {
      const selection = editor.getSelection();
      const range = selection || { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
      editor.executeEdits('snippet', [{ range, text: snippet.code }]);
    } else {
      handleCopy(snippet.code, `${snippet.name}-${snippet.language}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-nex-border/50">
        <div className="flex items-center gap-2">
          <Code2 size={13} className="text-nex-accent" />
          <span className="text-xs font-medium text-nex-text-dim">Snippets</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {SNIPPET_CATEGORIES.map((category) => (
          <div key={category.name}>
            <button onClick={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-colors">
              {expandedCategory === category.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="font-medium">{category.name}</span>
              <span className="text-[10px] text-nex-text-muted">({category.snippets.length})</span>
            </button>
            {expandedCategory === category.name && (
              <div className="animate-in">
                {category.snippets.map((snippet) => {
                  const key = `${snippet.name}-${snippet.language}`;
                  return (
                    <div key={key} className="group px-4 py-2 hover:bg-nex-card cursor-pointer transition-colors border-l-2 border-transparent hover:border-nex-accent"
                      onClick={() => handleInsert(snippet)}>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-nex-text">{snippet.name}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleCopy(snippet.code, key); }}
                          className="opacity-0 group-hover:opacity-100 text-nex-text-dim hover:text-nex-text transition-all">
                          {copiedIdx === key ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                        </button>
                      </div>
                      <div className="text-[10px] text-nex-text-muted mt-0.5">{snippet.description}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
