'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/lib/theme';
import type { editor } from 'monaco-editor';
import type * as monaco from 'monaco-editor';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface TableInfo {
	name: string;
	columns: Array<{
		cid?: number;
		name: string;
		type: string;
		notnull?: number;
		dflt_value?: unknown;
		pk?: number;
	}>;
}

interface EditorProps {
	value: string;
	onChange: (value: string) => void;
	onRun?: () => void;
	readOnly?: boolean;
	height?: string;
	loading?: boolean;
	tables?: TableInfo[];
	disableRunShortcut?: boolean; // Disable Ctrl+Enter shortcut when true
}

// SQL keywords for autocomplete (moved outside component to avoid dependency issues)
const SQL_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
	'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL',
	'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP',
	'ALTER', 'ADD', 'COLUMN', 'PRIMARY KEY', 'FOREIGN KEY', 'INDEX', 'UNIQUE', 'NOT NULL',
	'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG',
	'MAX', 'MIN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'ALL', 'EXISTS',
	'TRUNCATE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'WITH', 'CAST',
	'INTEGER', 'TEXT', 'REAL', 'BLOB', 'NULL', 'TRUE', 'FALSE', 'ASC', 'DESC'
];

export function Editor({ value, onChange, onRun, readOnly = false, height = '400px', loading = false, tables = [], disableRunShortcut = false }: EditorProps) {
	const { theme } = useTheme();
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof monaco | null>(null);
	const providerRef = useRef<monaco.IDisposable | null>(null);
	const [monacoReady, setMonacoReady] = useState(false);
	
	// Combine readOnly with loading state
	const isReadOnly = readOnly || loading;

	useEffect(() => {
		// Don't register the shortcut if it's disabled (e.g., when AI modal is open)
		if (disableRunShortcut) {
			return;
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				onRun?.();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onRun, disableRunShortcut]);

	// Setup autocomplete provider - runs when Monaco is ready or tables change
	useEffect(() => {
		if (!monacoRef.current || !monacoReady) return;

		// Dispose previous provider if exists
		if (providerRef.current) {
			providerRef.current.dispose();
		}

		const monaco = monacoRef.current;
		const language = 'sql';

		// Register completion provider
		const provider = monaco.languages.registerCompletionItemProvider(language, {
			provideCompletionItems: (model, position) => {
				const word = model.getWordUntilPosition(position);
				const range = {
					startLineNumber: position.lineNumber,
					endLineNumber: position.lineNumber,
					startColumn: word.startColumn,
					endColumn: word.endColumn,
				};

				const suggestions: monaco.languages.CompletionItem[] = [];

				// Add SQL keywords
				SQL_KEYWORDS.forEach((keyword) => {
					suggestions.push({
						label: keyword,
						kind: monaco.languages.CompletionItemKind.Keyword,
						insertText: keyword,
						range,
						detail: 'SQL Keyword',
						sortText: `0_${keyword}`, // Sort keywords first
					});
				});

				// Add table names
				tables.forEach((table) => {
					suggestions.push({
						label: table.name,
						kind: monaco.languages.CompletionItemKind.Class,
						insertText: table.name,
						range,
						detail: 'Table',
						documentation: `Table: ${table.name}`,
						sortText: `1_${table.name}`, // Sort tables after keywords
					});

					// Add column names for each table (with table prefix)
					table.columns.forEach((column) => {
						suggestions.push({
							label: `${table.name}.${column.name}`,
							kind: monaco.languages.CompletionItemKind.Field,
							insertText: `${table.name}.${column.name}`,
							range,
							detail: `Column (${table.name})`,
							documentation: `Column ${column.name} (${column.type}) from table ${table.name}`,
							sortText: `2_${table.name}.${column.name}`, // Sort prefixed columns after tables
						});
					});
				});

				// Add column names without table prefix (for convenience)
				tables.forEach((table) => {
					table.columns.forEach((column) => {
						// Only add if not already added (avoid duplicates)
						if (!suggestions.find(s => s.label === column.name && s.detail?.includes('Column'))) {
							suggestions.push({
								label: column.name,
								kind: monaco.languages.CompletionItemKind.Field,
								insertText: column.name,
								range,
								detail: `Column (${column.type})`,
								documentation: `Column ${column.name} (${column.type})`,
								sortText: `3_${column.name}`, // Sort standalone columns last
							});
						}
					});
				});

				return { suggestions };
			},
			triggerCharacters: ['.', ' '],
		});

		providerRef.current = provider;

		return () => {
			if (providerRef.current) {
				providerRef.current.dispose();
				providerRef.current = null;
			}
		};
	}, [tables, monacoReady]);

	const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
		setMonacoReady(true); // Mark Monaco as ready to trigger autocompletion setup
	};

	return (
		<div className={`relative border border-border rounded-lg overflow-hidden ${loading ? 'editor-loading' : ''}`}>
			<MonacoEditor
				height={height}
				language="sql"
				theme={theme === 'dark' ? 'vs-dark' : 'vs'}
				value={value}
				onChange={(val) => onChange(val || '')}
				onMount={handleEditorDidMount}
				options={{
					readOnly: isReadOnly,
					minimap: { enabled: false },
					fontSize: 14,
					lineNumbers: 'on',
					lineNumbersMinChars: 2,
					glyphMargin: false,
					lineDecorationsWidth: 0,
					roundedSelection: false,
					scrollBeyondLastLine: false,
					automaticLayout: true,
					tabSize: 2,
					wordWrap: 'on',
					folding: true,
					formatOnPaste: true,
					suggestOnTriggerCharacters: true,
					acceptSuggestionOnEnter: 'on',
					quickSuggestions: {
						other: true,
						comments: false,
						strings: false,
					},
					suggestSelection: 'first',
					tabCompletion: 'on',
				}}
			/>
			{loading && (
				<div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
					<div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/90 border border-border shadow-lg">
						<div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
						<span className="text-sm font-medium text-foreground">Fixing SQL with AI...</span>
					</div>
				</div>
			)}
			{!isReadOnly && (
				<div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
					Press Cmd/Ctrl+Enter to run
				</div>
			)}
		</div>
	);
}

