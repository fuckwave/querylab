'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { MobileHeader } from '@/components/MobileHeader';
import { Footer } from '@/components/Footer';
import { Editor } from '@/components/Editor';
import { ResultTable } from '@/components/ResultTable';
import { SchemaExplorer } from '@/components/SchemaExplorer';
import { AiModal } from '@/components/AiModal';
import { AiCodePopup } from '@/components/AiCodePopup';
import { LoginModal } from '@/components/LoginModal';
import { CodeVerificationModal } from '@/components/CodeVerificationModal';
import { AuthErrorModal } from '@/components/AuthErrorModal';
import { DatabaseSelector } from '@/components/DatabaseSelector';
import {
	createDb,
	createNamedDb,
	loadDbFromStorage,
	saveDbToStorage,
	runQuery,
	listTables,
	getTableSchema,
	importSqlFile,
	exportDbAsSql,
	validateSqlFile,
	listAllDatabases,
	deleteDatabase,
	type Database,
} from '@/lib/sqlClient';
import { extractSchema } from '@/lib/schemaExtractor';
import { extractTableData } from '@/lib/dataExtractor';
import { getRelevantTables } from '@/lib/sqlAnalyzer';
import { Api } from '@/lib/api';
import { toast } from 'sonner';

// Helper to detect if SQL is UPDATE, INSERT, or DROP
function isModifyingQuery(sql: string): boolean {
	const upperSql = sql.trim().toUpperCase();
	return (
		upperSql.includes('UPDATE') ||
		upperSql.includes('INSERT') ||
		upperSql.includes('DROP') ||
		upperSql.includes('CREATE') ||
		upperSql.includes('DELETE') ||
		upperSql.includes('ALTER')
	);
}


interface TableInfo {
	name: string;
	columns: Array<{
		cid: number;
		name: string;
		type: string;
		notnull: number;
		dflt_value: unknown;
		pk: number;
	}>;
}

export default function HomePage() {
	const [db, setDb] = useState<Database | null>(null);
	const [currentDbKey, setCurrentDbKey] = useState<string>('');
	const [sql, setSql] = useState(
		`-- You can use AI to generate SQL for you (look for the "Ask AI" button).
-- The database schema is shown in the panel to the left (or below on mobile).
-- Your SQL query here...`
	);
	const [results, setResults] = useState<unknown[]>([]);
	const [columns, setColumns] = useState<string[]>([]);
	const [tables, setTables] = useState<TableInfo[]>([]);
	const [schemaLoading, setSchemaLoading] = useState(false); // Loading state for schema updates
	const [loading, setLoading] = useState(true);
	const [isInitializing, setIsInitializing] = useState(false); // First-time DB initialization
	const [initProgress, setInitProgress] = useState({ current: 0, total: 0, message: '' }); // Progress tracking
	const [executing, setExecuting] = useState(false);
	const [aiLoading, setAiLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorSql, setErrorSql] = useState<string | null>(null);
	const [aiPrompt, setAiPrompt] = useState('');
	const [showAiModal, setShowAiModal] = useState(false);
	const [aiCodePopup, setAiCodePopup] = useState<{ code: string; message: string; explanation?: string } | null>(null);
	const [fixingSql, setFixingSql] = useState(false);
	const [explanation, setExplanation] = useState<string | null>(null);
	const [aiAbortController, setAiAbortController] = useState<AbortController | null>(null);
	const [fixAbortController, setFixAbortController] = useState<AbortController | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [loadingSuggestions, setLoadingSuggestions] = useState(false);
	const [showLoginModal, setShowLoginModal] = useState(false);
	const [showCodeModal, setShowCodeModal] = useState(false);
	const [_currentDbName, setCurrentDbName] = useState<string>('');

	// Get current database name
	useEffect(() => {
		async function getDbName() {
			if (currentDbKey) {
				try {
					const { getDbMetadata } = await import('@/lib/indexedDb');
					const metadata = await getDbMetadata(currentDbKey);
					setCurrentDbName(metadata?.name || 'Unknown Database');
				} catch {
					setCurrentDbName('Unknown Database');
				}
			} else {
				setCurrentDbName('');
			}
		}
		getDbName();
	}, [currentDbKey]);

	const [pendingEmail, setPendingEmail] = useState<string>('');
	const [showAuthError, setShowAuthError] = useState(false);
	const [authError, setAuthError] = useState<{ code?: string; message?: string } | null>(null);
	const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

	// Listen for open-login event from CodeVerificationModal
	useEffect(() => {
		const handleOpenLogin = () => {
			setShowCodeModal(false);
			setPendingEmail('');
			setShowLoginModal(true);
		};

		window.addEventListener('open-login', handleOpenLogin);
		return () => {
			window.removeEventListener('open-login', handleOpenLogin);
		};
	}, []);

	// Load prepared database from public/db folder
	const loadPreparedDatabase = useCallback(async (filename: string, name: string): Promise<{ db: Database; key: string } | null> => {
		try {
			// Fetch SQL file
			const response = await fetch(`/db/${filename}`);
			if (!response.ok) {
				toast.error(`Failed to load prepared database: ${filename}`);
				return null;
			}
			const sqlContent = await response.text();
			
			if (!sqlContent.trim()) {
				toast.error(`Empty SQL file: ${filename}`);
				return null;
			}
			
			// Create new database with proper name based on filename
			// This creates an empty database first
			const { db, key } = await createNamedDb(name);
			
			// Wait for database to be ready
			await db.waitReady;
			
			// Execute SQL using importSqlFile - properly handles long SQL files
			// It splits statements, orders them (sequences, tables, inserts), converts SQLite syntax
			const importResult = await importSqlFile(db, sqlContent);
			
			if (!importResult.ok) {
				// If import fails, clean up the database
				await deleteDatabase(key);
				toast.error(`Failed to import SQL for ${name}: ${importResult.error}`);
				return null;
			}
			
			// Save database to storage after successful SQL execution (like editor does)
			await saveDbToStorage(key, db);
			
			// Verify database has tables (basic check that SQL executed correctly)
			try {
				const tables = await listTables(db);
				if (tables.length === 0) {
					toast.warning(`${name} was created but has no tables - SQL may not have executed correctly`);
				}
			} catch {
				toast.warning(`Could not verify tables in ${name}`);
			}
			
			return { db, key };
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			toast.error(`Error loading ${name}: ${errorMsg}`);
			return null;
		}
	}, []);

	// Initialize database
	useEffect(() => {
		async function init() {
			try {
				setLoading(true);
				
				// Check if we have any databases
				const existingDbs = await listAllDatabases();
				
				// If no databases exist, auto-install both prepared databases
				if (existingDbs.length === 0) {
					setLoading(false); // Hide main loader, show init loader instead
					setIsInitializing(true);
					setInitProgress({ current: 0, total: 2, message: 'Starting database setup...' });
					
					// Load both prepared databases sequentially with progress updates
					setInitProgress({ current: 0, total: 2, message: 'Installing E-Commerce Database...' });
					const ecommerceDbResult = await Promise.allSettled([
						loadPreparedDatabase('ecommerce.sql', 'E-Commerce Database'),
					]);
					const ecommerce = ecommerceDbResult[0].status === 'fulfilled' ? ecommerceDbResult[0].value : null;
					
					setInitProgress({ current: 1, total: 2, message: 'Installing University Database...' });
					const universityDbResult = await Promise.allSettled([
						loadPreparedDatabase('university.sql', 'University Database'),
					]);
					const university = universityDbResult[0].status === 'fulfilled' ? universityDbResult[0].value : null;
					
					setInitProgress({ current: 2, total: 2, message: 'Finalizing setup...' });
					
					// Always set both databases - use E-Commerce as default if available
					if (ecommerce && university) {
						// Both loaded successfully - set E-Commerce as active, but both are available
						setDb(ecommerce.db);
						setCurrentDbKey(ecommerce.key);
						await updateSchema(ecommerce.db);
						await loadSuggestions(ecommerce.db);
						toast.success('Both databases installed! Using E-Commerce Database.');
					} else if (ecommerce) {
						setDb(ecommerce.db);
						setCurrentDbKey(ecommerce.key);
						await updateSchema(ecommerce.db);
						await loadSuggestions(ecommerce.db);
						toast.success('E-Commerce Database installed and ready!');
						if (!university) {
							toast.warning('University Database installation failed');
						}
					} else if (university) {
						setDb(university.db);
						setCurrentDbKey(university.key);
						await updateSchema(university.db);
						await loadSuggestions(university.db);
						toast.success('University Database installed and ready!');
						toast.warning('E-Commerce Database installation failed');
					} else {
						// Both failed to load - show error but don't create empty database
						const errorMsg = 'Failed to load prepared databases. Please refresh the page or try importing a database manually.';
						setError(errorMsg);
						toast.error(errorMsg);
					}
					
					setIsInitializing(false);
					setLoading(false); // Ensure loading is false after initialization
				} else {
					// Load the first available database (most recent)
					const firstDb = await loadDbFromStorage(existingDbs[0].key);
					if (firstDb) {
						setDb(firstDb);
						setCurrentDbKey(existingDbs[0].key);
						await updateSchema(firstDb);
						await loadSuggestions(firstDb);
					} else {
						// If first DB failed to load, try to install both prepared databases
						setLoading(false); // Hide main loader, show init loader instead
						setIsInitializing(true);
						toast.warning('Failed to load existing database. Installing sample databases...');
						
						setInitProgress({ current: 0, total: 2, message: 'Installing E-Commerce Database...' });
						const ecommerceDbResult = await Promise.allSettled([
							loadPreparedDatabase('ecommerce.sql', 'E-Commerce Database'),
						]);
						const ecommerce = ecommerceDbResult[0].status === 'fulfilled' ? ecommerceDbResult[0].value : null;
						
						setInitProgress({ current: 1, total: 2, message: 'Installing University Database...' });
						const universityDbResult = await Promise.allSettled([
							loadPreparedDatabase('university.sql', 'University Database'),
						]);
						const university = universityDbResult[0].status === 'fulfilled' ? universityDbResult[0].value : null;
						
						setInitProgress({ current: 2, total: 2, message: 'Finalizing setup...' });
						
						// Set both databases - use E-Commerce as default if available
						if (ecommerce && university) {
							setDb(ecommerce.db);
							setCurrentDbKey(ecommerce.key);
							await updateSchema(ecommerce.db);
							await loadSuggestions(ecommerce.db);
							toast.success('Both databases installed! Using E-Commerce Database.');
						} else if (ecommerce) {
							setDb(ecommerce.db);
							setCurrentDbKey(ecommerce.key);
							await updateSchema(ecommerce.db);
							await loadSuggestions(ecommerce.db);
							toast.success('E-Commerce Database installed and ready!');
							if (!university) {
								toast.warning('University Database installation failed');
							}
						} else if (university) {
							setDb(university.db);
							setCurrentDbKey(university.key);
							await updateSchema(university.db);
							await loadSuggestions(university.db);
							toast.success('University Database installed and ready!');
							toast.warning('E-Commerce Database installation failed');
						} else {
							toast.error('Failed to load databases. Please try importing a database manually.');
						}
						
						setIsInitializing(false);
						setLoading(false); // Ensure loading is false after initialization
					}
				}
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Failed to initialize database';
				setError(errorMsg);
				toast.error(errorMsg);
				setIsInitializing(false);
			} finally {
				if (!isInitializing) {
					setLoading(false);
				}
			}
		}
		init();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	
	// Update schema when database changes
	useEffect(() => {
		async function refreshSchema() {
			if (db) {
				await updateSchema(db);
			} else {
				setTables([]);
			}
		}
		
		refreshSchema();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [db, currentDbKey]);
	
	// Update suggestions when database changes
	useEffect(() => {
		async function refreshSuggestions() {
			if (db) {
				await loadSuggestions(db);
			}
		}
		
		refreshSuggestions();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [db, currentDbKey]);

	// Load AI suggestions
	const loadSuggestions = useCallback(async (database: Database | null) => {
		if (!database) return;
		
		setLoadingSuggestions(true);
		try {
			const schema = await extractSchema(database);
			const tableNames = await listTables(database);
			
			const response = await Api.getSuggestions({
				schema,
				allowedTables: tableNames,
			});
			
			if (response.success && response.data) {
				const newSuggestions = response.data.suggestions || [];
				setSuggestions(newSuggestions);
			}
			// Silently ignore auth errors and other errors - don't show auth modal or console logs
			// Just keep previous suggestions if loading fails
		} catch {
			// Silently fail - don't show error to user, don't log to console, keep previous suggestions
		} finally {
			setLoadingSuggestions(false);
		}
	}, []);

	// Update schema when database changes
	const updateSchema = useCallback(async (database: Database | null) => {
		try {
			if (!database || !database.waitReady) {
				setTables([]);
				setSchemaLoading(false);
				return;
			}
			
			// Set loading state and clear previous tables immediately
			setSchemaLoading(true);
			setTables([]); // Clear immediately for better UX
			
			await database.waitReady;
			const tableNames = await listTables(database);
			const tableInfos: TableInfo[] = [];
			
			for (const tableName of tableNames) {
				try {
					const schema = await getTableSchema(database, tableName);
					if (schema && Array.isArray(schema) && schema.length > 0) {
						const columns = schema.map((row: unknown) => {
							if (typeof row === 'object' && row !== null) {
								const r = row as Record<string, unknown>;
								return {
									cid: (r.cid as number) || 0,
									name: String(r.name || ''),
									type: String(r.type || ''),
									notnull: (r.notnull as number) || 0,
									dflt_value: r.dflt_value,
									pk: (r.pk as number) || 0,
								};
							}
							return {
								cid: 0,
								name: '',
								type: '',
								notnull: 0,
								dflt_value: null,
								pk: 0,
							};
						});
						tableInfos.push({ name: tableName, columns });
					}
				} catch {
					// Silent fail for individual table schema errors
				}
			}
			
			setTables(tableInfos);
			setSchemaLoading(false);
		} catch {
			setTables([]);
			setSchemaLoading(false);
		}
	}, []);

	// Parse and handle CREATE DATABASE and USE DATABASE commands
	const parseSpecialCommands = useCallback((sqlText: string): { 
		command: 'CREATE_DATABASE' | 'USE_DATABASE' | null; 
		databaseName: string | null;
		remainingSql: string;
	} => {
		const trimmed = sqlText.trim();
		
		// Check for CREATE DATABASE
		const createDbMatch = trimmed.match(/^CREATE\s+DATABASE\s+(\w+)\s*;?/i);
		if (createDbMatch) {
			return {
				command: 'CREATE_DATABASE',
				databaseName: createDbMatch[1],
				remainingSql: '',
			};
		}
		
		// Check for USE DATABASE
		const useDbMatch = trimmed.match(/^USE\s+DATABASE\s+(\w+)\s*;?/i);
		if (useDbMatch) {
			return {
				command: 'USE_DATABASE',
				databaseName: useDbMatch[1],
				remainingSql: '',
			};
		}
		
		return { command: null, databaseName: null, remainingSql: sqlText };
	}, []);

	// Execute SQL
	const executeSql = useCallback(async () => {
		if (!sql.trim()) return;
		
		// Check for special commands (CREATE DATABASE, USE DATABASE)
		const specialCommand = parseSpecialCommands(sql);
		
		if (specialCommand.command === 'CREATE_DATABASE') {
			try {
				setExecuting(true);
				const dbName = specialCommand.databaseName || 'New Database';
				const { db: newDb, key: newKey } = await createNamedDb(dbName);
				// Clear tables immediately for better UX
				setTables([]);
				setSchemaLoading(true);
				setDb(newDb);
				setCurrentDbKey(newKey);
				await updateSchema(newDb);
				loadSuggestions(newDb);
				setSql(''); // Clear editor
				setResults([]);
				setColumns([]);
				toast.success(`Database "${dbName}" created successfully!`);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Failed to create database';
				setError(errorMsg);
				toast.error('Failed to create database');
			} finally {
				setExecuting(false);
			}
			return;
		}
		
		if (specialCommand.command === 'USE_DATABASE') {
			try {
				setExecuting(true);
				const dbName = specialCommand.databaseName;
				if (!dbName) {
					toast.error('Database name is required');
					return;
				}
				
				// Find database by name
				const allDbs = await listAllDatabases();
				const targetDb = allDbs.find(d => d.name.toLowerCase() === dbName.toLowerCase());
				
				if (!targetDb) {
					toast.error(`Database "${dbName}" not found`);
					return;
				}
				
				const loadedDb = await loadDbFromStorage(targetDb.key);
				if (!loadedDb) {
					toast.error(`Failed to load database "${dbName}"`);
					return;
				}
				
				// Clear tables immediately for better UX
				setTables([]);
				setSchemaLoading(true);
				setDb(loadedDb);
				setCurrentDbKey(targetDb.key);
				await updateSchema(loadedDb);
				loadSuggestions(loadedDb);
				setSql(''); // Clear editor
				setResults([]);
				setColumns([]);
				toast.success(`Switched to database "${targetDb.name}"`);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Failed to switch database';
				setError(errorMsg);
				toast.error('Failed to switch database');
			} finally {
				setExecuting(false);
			}
			return;
		}
		
		// Regular SQL execution
		if (!db) return;
		
		setExecuting(true);
		setError(null);
		setExplanation(null); // Clear explanation when running SQL
		
		try {
			const result = await runQuery(db, specialCommand.remainingSql || sql);
			
			if (result.ok) {
				if (result.results.length > 0) {
					const firstResult = result.results[0] as { columns: string[]; values: unknown[][] };
					if (firstResult && 'columns' in firstResult && 'values' in firstResult) {
						setColumns(firstResult.columns);
						// Convert rows to objects
						const rows = firstResult.values.map((row) => {
							const obj: Record<string, unknown> = {};
							firstResult.columns.forEach((col, idx) => {
								obj[col] = row[idx];
							});
							return obj;
						});
						setResults(rows);
					} else {
						setResults(result.results);
					}
				} else {
					setResults([]);
					setColumns([]);
				}
				
				// Clear explanation when SQL runs successfully
				setExplanation(null);
				
				// Save database after execution
				await saveDbToStorage(currentDbKey, db);
				
				// Only reload schema if this was a modifying query (CREATE, ALTER, UPDATE, DROP, INSERT, DELETE)
				if (isModifyingQuery(sql)) {
					await updateSchema(db);
					loadSuggestions(db);
				}
			} else {
				const errorMsg = result.error;
				setError(errorMsg);
				setErrorSql(sql); // Store the SQL that caused the error
				setExplanation(null); // Clear explanation when error occurs
				setResults([]);
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Execution failed';
			setError(errorMsg);
			setErrorSql(sql); // Store the SQL that caused the error
			setExplanation(null); // Clear explanation when error occurs
			setResults([]);
		} finally {
			setExecuting(false);
		}
	}, [db, sql, updateSchema, loadSuggestions, currentDbKey, parseSpecialCommands]);

	// Cancel SQL fix
	const cancelFixSql = useCallback(() => {
		if (fixAbortController) {
			fixAbortController.abort();
			setFixAbortController(null);
			setFixingSql(false);
			setError(null);
			toast.info('Fix request cancelled');
		}
	}, [fixAbortController]);

	// Fix SQL with AI
	const fixSqlWithAi = useCallback(async () => {
		if (!db || !errorSql || !error) return;

		// Create abort controller for this request
		const abortController = new AbortController();
		setFixAbortController(abortController);
		setFixingSql(true);

		try {
			const schema = await extractSchema(db);
			const tableNames = await listTables(db);
			
			// Get only relevant tables from SQL and error message
			const relevantTables = getRelevantTables(errorSql, error);
			
			// Extract data only from relevant tables (or all if no specific tables found)
			const tableDataObj = relevantTables.length > 0
				? await extractTableData(db, 1000, relevantTables) // Only relevant tables
				: await extractTableData(db, 1000); // Fallback to all tables if we can't determine relevance

			// Convert tableData object to array format expected by API
			const tableData = Object.entries(tableDataObj).map(([name, rows]) => ({
				name,
				rows,
				rowCount: rows.length,
			}));

			const response = await Api.fixSql({
				errorSql,
				errorMessage: error,
				schema,
				tableData, // Send full table data for AI context
				allowedTables: tableNames,
			}, abortController.signal);

			// Check if request was cancelled
			if (abortController.signal.aborted) {
				return;
			}

			if (response.success && response.data) {
				const data = response.data;
				
				// Only set SQL if code is SUCCESS and SQL exists
				if (data.code === 'SUCCESS' && data.sql && data.sql.trim()) {
					setSql(data.sql);
					setErrorSql(null);
					setError(null);
					
					// Store explanation if provided
					if (data.explanation) {
						setExplanation(data.explanation);
					}
					
					toast.success('SQL fixed successfully!');
				} else {
					// Code is not SUCCESS or no SQL - show error/message
					if (data.code && data.message) {
						// Show error popup for non-SUCCESS codes
						setAiCodePopup({
							code: data.code,
							message: data.message,
							explanation: data.explanation,
						});
					} else {
						setError(data.message || 'Failed to fix SQL - no SQL returned');
						toast.error(data.message || 'Failed to fix SQL');
					}
				}
			} else {
				// Handle auth errors
				const errorCode = response.error?.code;
				if (errorCode === 'AUTH_MISSING' || errorCode === 'SESSION_NOT_FOUND') {
					// Close any open modals first
					setShowAiModal(false);
					
					// Use setTimeout to ensure modal closes before opening auth error
					setTimeout(() => {
						setAuthError({
							code: errorCode,
							message: response.error?.message || 'Authentication required',
						});
						setShowAuthError(true);
					}, 100);
					return;
				}
				
				// Don't show error if cancelled
				if (response.error?.code !== 'CANCELLED') {
					const errorMsg =
						response.error && typeof response.error === 'object' && 'message' in response.error
							? String(response.error.message)
							: 'Failed to fix SQL';
					setError(errorMsg);
					toast.error(errorMsg);
				}
			}
		} catch (err) {
			if (!abortController.signal.aborted) {
				const errorMsg = err instanceof Error ? err.message : 'AI fix request failed';
				setError(errorMsg);
				toast.error(errorMsg);
			}
		} finally {
			if (!abortController.signal.aborted) {
				setFixingSql(false);
				setFixAbortController(null);
			}
		}
	}, [db, errorSql, error]);

	// Cancel AI generation
	const cancelAiGeneration = useCallback(() => {
		if (aiAbortController) {
			aiAbortController.abort();
			setAiAbortController(null);
			setAiLoading(false);
			toast.info('AI request cancelled');
		}
	}, [aiAbortController]);

	// Generate SQL with AI
	const generateSql = useCallback(async () => {
		if (!aiPrompt.trim() || !db) return;
		
		// Create abort controller for this request
		const abortController = new AbortController();
		setAiAbortController(abortController);
		setAiLoading(true);
		setError(null);
		setExplanation(null); // Clear previous explanation when generating new SQL
		
		try {
			// Extract full schema from database
			const schema = await extractSchema(db);
			const tableNames = await listTables(db);
			
			const response = await Api.generateSql({
				prompt: aiPrompt,
				runSql: false,
				allowedTables: tableNames,
				schema, // Always send full schema
			}, abortController.signal);
			
			// Check if request was cancelled
			if (abortController.signal.aborted) {
				return;
			}
			
			if (response.success && response.data) {
				const data = response.data;
				
				// Handle AI codes and messages
				if (data.code && data.message) {
					// Show AI message to user
					if (data.code === 'SUCCESS' && data.sql) {
						setSql(data.sql);
						setShowAiModal(false);
						setAiPrompt('');
						setError(null);
						
						// Store explanation if provided
						if (data.explanation) {
							setExplanation(data.explanation);
						}
						
						toast.success('SQL generated successfully!');
					} else {
						// For non-SUCCESS codes: close modal and show popup
						// DO NOT set SQL in editor if code is not SUCCESS
						setShowAiModal(false);
						setAiPrompt('');
						setAiCodePopup({
							code: data.code,
							message: data.message,
							explanation: data.explanation,
						});
						// Don't set SQL - let user see the error popup instead
					}
				} else if (data.sql && data.code === 'SUCCESS') {
					// Fallback: if SQL exists and code is SUCCESS, use it (legacy support)
					setSql(data.sql);
					setShowAiModal(false);
					setAiPrompt('');
					
					// Store explanation if provided
					if (data.explanation) {
						setExplanation(data.explanation);
					}
					
					toast.success('SQL generated!');
				} else {
					setError('Failed to generate SQL');
					toast.error('Failed to generate SQL');
				}
			} else if (!response.success) {
				// Handle auth errors
				const errorCode = response.error?.code;
				if (errorCode === 'AUTH_MISSING' || errorCode === 'SESSION_NOT_FOUND') {
					// Close AI modal first
					setShowAiModal(false);
					setAiPrompt('');
					
					// Use setTimeout to ensure modal closes before opening auth error
					setTimeout(() => {
						setAuthError({
							code: errorCode,
							message: response.error?.message || 'Authentication required',
						});
						setShowAuthError(true);
					}, 100);
					return;
				}
				
				// Don't show error if cancelled
				if (response.error?.code !== 'CANCELLED') {
					const errorMsg =
						response.error && typeof response.error === 'object' && 'message' in response.error
							? String(response.error.message)
							: 'Failed to generate SQL';
					setError(errorMsg);
					toast.error(errorMsg);
				}
			} else {
				setError('Failed to generate SQL');
				toast.error('Failed to generate SQL');
			}
		} catch (err) {
			if (!abortController.signal.aborted) {
				setError(err instanceof Error ? err.message : 'AI request failed');
				toast.error(err instanceof Error ? err.message : 'AI request failed');
			}
		} finally {
			if (!abortController.signal.aborted) {
				setAiLoading(false);
				setAiAbortController(null);
			}
		}
	}, [aiPrompt, db]);

	// Handle file selection - import as new database
	const handleFileSelect = useCallback(async (file: File) => {
		// Validate file extension
		if (!file.name.endsWith('.sql')) {
			setError('Invalid file type. Please upload a .sql file');
			return;
		}
		
		setError(null);
		setLoading(true);

		try {
			// Read file content
			const content = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					const result = e.target?.result as string;
					resolve(result);
				};
				reader.onerror = reject;
				reader.readAsText(file);
			});

			// Validate SQL file
			const validation = validateSqlFile(content);
			if (!validation.valid) {
				setError(validation.error || 'Invalid SQL file');
				setLoading(false);
				toast.error('Invalid SQL file');
				return;
			}

			// Create a new database for the import
			const importedDb = await createDb();
			const importResult = await importSqlFile(importedDb, content);
			
			if (!importResult.ok) {
				setError(importResult.error);
				setLoading(false);
				toast.error(`Import failed: ${importResult.error}`);
				return;
			}

			// Test the database by listing tables (ensures it's valid)
			try {
				const tables = await listTables(importedDb);
				if (tables.length === 0 && validation.statements.length > 0) {
					// Database is empty but SQL was provided - might be valid but no tables created
					// This is okay, continue
				}
			} catch {
				// Database is corrupted or invalid
				setError('Imported database is invalid or corrupted');
				setLoading(false);
				toast.error('Imported database is invalid');
				return;
			}

			// Import is valid - create new database with default name from file
			try {
				// Extract name from filename (remove .sql extension)
				const defaultName = file.name.replace(/\.sql$/i, '') || 'Imported Database';
				
				// Create new named database
				const { db: newDb, key: newKey } = await createNamedDb(defaultName);
				
				// Import the SQL into the new database
				const finalImportResult = await importSqlFile(newDb, content);
				
				if (!finalImportResult.ok) {
					await deleteDatabase(newKey);
					setError(finalImportResult.error);
					setLoading(false);
					toast.error(`Import failed: ${finalImportResult.error}`);
					return;
				}
				
				// Switch to the new database
				setDb(newDb);
				setCurrentDbKey(newKey);
				updateSchema(newDb);
				loadSuggestions(newDb);
				setSql(''); // Clear editor
				setResults([]);
				setColumns([]);
				setError(null);
				
				toast.success(`Database "${defaultName}" imported successfully!`);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Failed to save imported database';
				setError(errorMsg);
				toast.error('Failed to save imported database');
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Failed to import database';
			setError(errorMsg);
			toast.error('Failed to import database');
		} finally {
			setLoading(false);
		}
	}, [updateSchema, loadSuggestions]);

	// Export database as SQL
	const handleExport = useCallback(async () => {
		if (!db) return;
		
		const sqlContent = await exportDbAsSql(db);
		const blob = new Blob([sqlContent], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `querylab-export-${Date.now()}.sql`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}, [db]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault();
				if (db && currentDbKey) {
					saveDbToStorage(currentDbKey, db);
				}
			}
			if (e.key === 'Escape') {
				setShowAiModal(false);
				setAiCodePopup(null);
			}
		};
		
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [db, currentDbKey]);

	// Rotate loading messages
	useEffect(() => {
		if (!loading) return;
		
		const messages = [
			'Connecting to your database...',
			'Loading schema information...',
			'Preparing query engine...',
			'Setting up workspace...',
			'Almost ready...',
		];
		
		const interval = setInterval(() => {
			setLoadingMessageIndex((prev) => (prev + 1) % messages.length);
		}, 1500);
		
		return () => clearInterval(interval);
	}, [loading]);

	// Show init loader if initializing (even if main loading is false)
	if (isInitializing) {
			const progressPercent = initProgress.total > 0 ? (initProgress.current / initProgress.total) * 100 : 0;
			const circumference = 2 * Math.PI * 36; // radius = 36 (72/2)
			const offset = circumference - (progressPercent / 100) * circumference;
			
			return (
				<div className="flex items-center justify-center min-h-screen bg-background">
					<div className="text-center space-y-6 max-w-md px-4">
						<div className="relative w-20 h-20 mx-auto">
							{/* Background circle */}
							<svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 80 80">
								<circle
									cx="40"
									cy="40"
									r="36"
									stroke="currentColor"
									strokeWidth="8"
									fill="none"
									className="text-primary/20"
								/>
								{/* Progress circle */}
								<circle
									cx="40"
									cy="40"
									r="36"
									stroke="currentColor"
									strokeWidth="8"
									fill="none"
									strokeDasharray={circumference}
									strokeDashoffset={offset}
									strokeLinecap="round"
									className="text-primary transition-all duration-300 ease-out"
								/>
							</svg>
							{/* Percentage text */}
							<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary font-semibold text-sm">
								{Math.round(progressPercent)}%
							</div>
						</div>
						
						<div className="space-y-2">
							<p className="text-xl font-bold text-foreground">Welcome to QueryLab!</p>
							<p className="text-base text-muted-foreground">{initProgress.message || 'Setting up your learning environment...'}</p>
						</div>
						
						{/* Progress bar */}
						<div className="w-full bg-muted rounded-full h-2 overflow-hidden">
							<div 
								className="bg-primary h-full transition-all duration-300 ease-out rounded-full"
								style={{ width: `${progressPercent}%` }}
							></div>
						</div>
						
						{/* Step indicators */}
						<div className="flex items-center justify-center gap-3 pt-2">
							<div className={`w-2 h-2 rounded-full transition-all ${initProgress.current >= 1 ? 'bg-primary' : 'bg-muted'}`}></div>
							<div className={`w-8 h-0.5 transition-all ${initProgress.current >= 1 ? 'bg-primary' : 'bg-muted'}`}></div>
							<div className={`w-2 h-2 rounded-full transition-all ${initProgress.current >= 2 ? 'bg-primary' : 'bg-muted'}`}></div>
						</div>
						
						<p className="text-xs text-muted-foreground pt-2">This only happens once. We&apos;re preparing sample databases for you!</p>
					</div>
			</div>
		);
	}
	
	// Normal loading (simple spinner) - only show if not initializing
	if (loading) {
		const messages = [
			'Connecting to your database...',
			'Loading schema information...',
			'Preparing query engine...',
			'Setting up workspace...',
			'Almost ready...',
		];
		
		return (
			<div className="flex items-center justify-center min-h-screen bg-background">
				<div className="text-center space-y-6 max-w-md px-4">
					<div className="relative w-20 h-20 mx-auto">
						<div className="w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
						<div className="absolute inset-0 flex items-center justify-center">
							<img 
								src="/favicon.svg" 
								alt="QueryLab" 
								className="w-10 h-10"
							/>
						</div>
					</div>
					<div className="space-y-3">
						<p className="text-2xl font-bold text-foreground">Welcome to QueryLab</p>
						<div className="h-8 flex items-center justify-center">
							<p className="text-base text-muted-foreground transition-opacity duration-500">
								{messages[loadingMessageIndex]}
							</p>
						</div>
					</div>
					<div className="flex items-center justify-center gap-2 pt-2">
						<div className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
						<div className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></div>
						<div className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background flex flex-col">
			<MobileHeader onLogin={() => setShowLoginModal(true)} />
			
			<main className="container mx-auto px-4 py-6 max-w-7xl flex-1">
				{/* Action Buttons */}
				<div className="flex flex-wrap gap-2 mb-4">
					<button
						onClick={executeSql}
						disabled={executing || !db}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{executing ? 'Running...' : 'Run Query'}
					</button>
					<button
						onClick={() => setShowAiModal(true)}
						className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
					>
						Ask AI
					</button>
					<button
						onClick={() => fileInputRef.current?.click()}
						className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
					>
						Import SQL
					</button>
					<button
						onClick={handleExport}
						disabled={!db}
						className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50 transition-colors"
					>
						Export SQL
					</button>
				</div>

				{/* Database Selector */}
				<div className="mb-4">
					<DatabaseSelector
						currentDbKey={currentDbKey}
						onDatabaseChange={async (newDb, key) => {
							// Clear tables immediately for better UX
							setTables([]);
							setSchemaLoading(true);
							setDb(newDb);
							setCurrentDbKey(key);
							// Clear old results and errors
							setResults([]);
							setColumns([]);
							setError(null);
							setErrorSql(null);
							// Update schema and suggestions
							await updateSchema(newDb);
							await loadSuggestions(newDb);
						}}
						onDatabaseCreated={(key) => {
							setCurrentDbKey(key);
						}}
					/>
				</div>

				<input
					ref={fileInputRef}
					type="file"
					accept=".sql"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) {
							handleFileSelect(file);
						}
						// Reset input so same file can be selected again
						e.target.value = '';
					}}
				/>

				{error && (
					<div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 overflow-hidden shadow-sm">
						<div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-start justify-between gap-3">
							<div className="flex items-start gap-3 flex-1">
								<div className="flex-shrink-0 mt-0.5">
									<svg
										className="w-5 h-5 text-destructive"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
								</div>
								<div className="flex-1 min-w-0">
									<p className="font-semibold text-destructive mb-1">SQL Error</p>
									<p className="text-sm text-destructive/90 break-words">{error}</p>
								</div>
							</div>
							{errorSql && (
								<div className="flex-shrink-0">
									{fixingSql ? (
										<button
											onClick={cancelFixSql}
											className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors text-sm whitespace-nowrap font-medium"
										>
											Cancel
										</button>
									) : (
										<button
											onClick={fixSqlWithAi}
											className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm whitespace-nowrap font-medium"
										>
											Fix With AI
										</button>
									)}
								</div>
							)}
						</div>
						{fixingSql && (
							<div className="px-4 py-2 bg-background/50 border-t border-destructive/10">
								<div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/90 border border-border shadow-lg w-fit">
									<div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
									<span className="text-sm font-medium text-foreground">AI is analyzing the error and fixing your SQL...</span>
								</div>
							</div>
						)}
					</div>
				)}

				{/* AI Explanation Section */}
				{explanation && !error && (
					<div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden shadow-sm">
						<div className="px-4 py-3 bg-primary/10 border-b border-primary/20 flex items-start justify-between gap-3">
							<div className="flex items-start gap-3 flex-1">
								<div className="flex-shrink-0 mt-0.5">
									<svg
										className="w-5 h-5 text-primary"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
								</div>
								<div className="flex-1 min-w-0">
									<p className="font-semibold text-primary mb-1">AI Explanation</p>
									<p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{explanation}</p>
								</div>
							</div>
							<button
								onClick={() => setExplanation(null)}
								className="flex-shrink-0 p-1 rounded-md hover:bg-primary/10 transition-colors text-primary/70 hover:text-primary"
								aria-label="Close explanation"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
					</div>
				)}

				<div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
					{/* Left: Editor and Results */}
					<div className="lg:col-span-3 space-y-4">
						{/* SQL Editor */}
						<div className="border border-border rounded-lg overflow-hidden">
							<div className="px-4 py-2 bg-muted/50 border-b border-border">
								<h2 className="text-sm font-semibold">SQL Editor</h2>
							</div>
							<div className="p-2">
								<Editor
									value={sql}
									onChange={setSql}
									onRun={executeSql}
									height="300px"
									loading={fixingSql}
									tables={tables}
									disableRunShortcut={showAiModal}
								/>
							</div>
						</div>
						
						{/* Results - Always visible below editor */}
						<div className="border border-border rounded-lg overflow-hidden">
							<div className="px-4 py-2 bg-muted/50 border-b border-border">
								<h2 className="text-sm font-semibold">Results</h2>
							</div>
							<div className="p-4">
								<ResultTable results={results} columns={columns} />
							</div>
						</div>
					</div>

					{/* Right: Schema Explorer */}
					<div className="lg:col-span-1">
					<SchemaExplorer
						tables={tables}
						loading={schemaLoading}
					/>
					</div>
				</div>
			</main>

			{/* AI Modal */}
			<AiModal
				isOpen={showAiModal}
				onClose={() => {
					setShowAiModal(false);
					setAiPrompt('');
				}}
				prompt={aiPrompt}
				onPromptChange={setAiPrompt}
				onGenerate={generateSql}
				loading={aiLoading}
				onCancel={cancelAiGeneration}
				suggestions={suggestions}
				loadingSuggestions={loadingSuggestions}
			/>

			{/* AI Code Popup */}
			{aiCodePopup && (
				<AiCodePopup
					code={aiCodePopup.code}
					message={aiCodePopup.message}
					explanation={aiCodePopup.explanation}
					onClose={() => setAiCodePopup(null)}
				/>
			)}


			{/* Login Modal */}
			<LoginModal
				isOpen={showLoginModal}
				onClose={() => setShowLoginModal(false)}
				onCodeSent={(email) => {
					setPendingEmail(email);
					setShowCodeModal(true);
				}}
			/>

			{/* Code Verification Modal */}
			<CodeVerificationModal
				isOpen={showCodeModal}
				onClose={() => {
					setShowCodeModal(false);
					setPendingEmail('');
					// Reset login modal state so user can try again
					setShowLoginModal(false);
				}}
				email={pendingEmail}
				onVerified={() => {
					setShowCodeModal(false);
					setPendingEmail('');
					toast.success('Login successful!');
				}}
			/>

			{/* Auth Error Modal */}
			<AuthErrorModal
				isOpen={showAuthError}
				onClose={() => {
					setShowAuthError(false);
					setAuthError(null);
				}}
				onOpenLogin={() => {
					setShowAuthError(false);
					setAuthError(null);
					setShowLoginModal(true);
				}}
				errorCode={authError?.code}
				message={authError?.message}
			/>

			<Footer />
		</div>
	);
}

