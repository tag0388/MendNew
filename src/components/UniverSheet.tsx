import React, { useEffect, useRef, useMemo } from 'react';
import { Univer, UniverInstanceType, LocaleType } from '@univerjs/core';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table';
import { UniverSheetsTableUIPlugin } from '@univerjs/sheets-table-ui';
import { FUniver } from '@univerjs/core/facade';
import { format, addMonths, startOfMonth, parseISO, isAfter } from 'date-fns';
import { Sheet, Project, Enterprise } from '../types';

// Import facades to register methods on FUniver
import '@univerjs/sheets/facade';
import '@univerjs/ui/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-data-validation/facade';
import '@univerjs/sheets-table/facade';

import enUS from '@univerjs/ui/locale/en-US';
import enSheets from '@univerjs/sheets/locale/en-US';
import enSheetsUI from '@univerjs/sheets-ui/locale/en-US';
import enDesign from '@univerjs/design/locale/en-US';
import enSheetsDataValidation from '@univerjs/sheets-data-validation-ui/locale/en-US';
import enSheetsNumfmt from '@univerjs/sheets-numfmt-ui/locale/en-US';
import enSheetsFormula from '@univerjs/sheets-formula-ui/locale/en-US';
import enSheetsTable from '@univerjs/sheets-table-ui/locale/en-US';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-data-validation-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-table-ui/lib/index.css';

interface UniverSheetProps {
  sheetId: string;
  sheetType: 'commitment' | 'time-based';
  project: Project;
  enterprise: Enterprise;
  data: any[];
  onDataChange: (newData: any[]) => void;
}

// Utility to get column name from index (0 -> A, 25 -> Z, 26 -> AA)
const getColumnName = (index: number) => {
  let name = '';
  while (index >= 0) {
    name = String.fromCharCode((index % 26) + 65) + name;
    index = Math.floor(index / 26) - 1;
  }
  return name;
};

export default function UniverSheet({ sheetId, sheetType, project, enterprise, data, onDataChange }: UniverSheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);

  // Generate phasing months
  const phasingMonths = useMemo(() => {
    const start = startOfMonth(parseISO(project.startDate || new Date().toISOString()));
    const end = parseISO(project.endDate || new Date().toISOString());
    const months = [];
    let current = start;
    while (!isAfter(current, end)) {
      months.push(format(current, 'MMM yy'));
      current = addMonths(current, 1);
    }
    return months;
  }, [project.startDate, project.endDate]);

  useEffect(() => {
    if (!containerRef.current) return;

    const univer = new Univer({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: {
          ...enUS,
          ...enSheets,
          ...enSheetsUI,
          ...enDesign,
          ...enSheetsDataValidation as any,
          ...enSheetsNumfmt as any,
          ...enSheetsTable as any,
        },
      },
    });

    univerRef.current = univer;

    // Core plugins
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container: containerRef.current,
      header: true,
      toolbar: true,
      footer: true,
    });

    // Sheet plugins
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverSheetsFormulaUIPlugin);
    univer.registerPlugin(UniverSheetsNumfmtPlugin);
    univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
    univer.registerPlugin(UniverSheetsDataValidationPlugin);
    univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
    univer.registerPlugin(UniverSheetsTablePlugin);
    univer.registerPlugin(UniverSheetsTableUIPlugin);

    // Doc plugins (needed for cell editing)
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);

    // Create workbook
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: sheetId,
      name: 'Forecast Sheet',
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: 'Forecast',
          cellData: mapDataToUniver(data, sheetType, phasingMonths, project),
          rowCount: Math.max(100, data.length + 20),
          columnCount: 50,
        },
      },
    });

    // Handle data changes via facade
    let unsubscribe: { dispose: () => void } = { dispose: () => {} };
    
    // Define handleManualCreateTable in useEffect scope so cleanup can access it
    let handleManualCreateTable = () => {};

    try {
      const facade = FUniver.newAPI(univer);
      
      // Setup Data Validation (Dropdowns) and Table
      const activeWorkbook = facade.getActiveWorkbook();
      if (activeWorkbook) {
        const activeSheet = activeWorkbook.getActiveSheet();
        if (activeSheet) {
          // Create Table (Column A to Column I + phasing months)
          const totalCols = 9 + phasingMonths.length;
          const totalRows = data.length + 1; // +1 for header
          
          const endColName = getColumnName(totalCols - 1);
          const rangeString = `A1:${endColName}${totalRows}`;
          
          // Add table via facade
          setTimeout(() => {
            try {
              console.log(`Attempting to create table for range: ${rangeString}`);
              const table = (activeSheet as any).addTable(rangeString);
              if (table) {
                console.log('Table created successfully via range string');
              }
            } catch (e) {
              console.warn('Could not add table via facade range string, trying indices', e);
              try {
                const table = (activeSheet as any).addTable(0, 0, totalRows, totalCols);
                if (table) console.log('Table created successfully via indices');
              } catch (e2) {
                console.error('All table creation attempts failed', e2);
              }
            }
          }, 1500); // Slightly longer delay

          // Category Dropdown (Column G - index 6)
          const categories = project.categories?.length ? project.categories : enterprise.categories || [];
          if (categories.length) {
            activeSheet.getRange(1, 6, 100, 1).setDataValidation({
              type: 3, // List
              formula1: categories.join(','),
              showErrorMessage: true,
              errorTitle: 'Invalid Category',
              error: 'Please select a category from the list.',
            } as any);
          }

          // Control Account Dropdown (Column H - index 7)
          const controlAccounts = project.controlAccounts?.length ? project.controlAccounts : enterprise.controlAccounts || [];
          if (controlAccounts.length) {
            activeSheet.getRange(1, 7, 100, 1).setDataValidation({
              type: 3, // List
              formula1: controlAccounts.join(','),
              showErrorMessage: true,
              errorTitle: 'Invalid Control Account',
              error: 'Please select a control account from the list.',
            } as any);
          }

          // Order Number Dropdown (Column I - index 8)
          const orderNumbers = project.orderNumbers?.length ? project.orderNumbers : enterprise.orderNumbers || [];
          if (orderNumbers.length) {
            activeSheet.getRange(1, 8, 100, 1).setDataValidation({
              type: 3, // List
              formula1: orderNumbers.join(','),
              showErrorMessage: true,
              errorTitle: 'Invalid Order Number',
              error: 'Please select an order number from the list.',
            } as any);
          }
        }
      }

      // Handle manual table creation event
      handleManualCreateTable = () => {
        const activeWorkbook = facade.getActiveWorkbook();
        if (activeWorkbook) {
          const activeSheet = activeWorkbook.getActiveSheet();
          if (activeSheet) {
            const totalCols = 9 + phasingMonths.length;
            const totalRows = data.length + 1;
            const endColName = getColumnName(totalCols - 1);
            const rangeString = `A1:${endColName}${totalRows}`;
            try {
              (activeSheet as any).addTable(rangeString);
              console.log('Manual table creation successful');
            } catch (e) {
              console.error('Manual table creation failed', e);
            }
          }
        }
      };
      window.addEventListener('univer-create-table', handleManualCreateTable);

      let debounceTimer: any = null;
      unsubscribe = facade.onCommandExecuted((command: any) => {
        const commandsToWatch = [
          'sheet.command.set-range-values',
          'sheet.command.insert-row',
          'sheet.command.delete-row',
          'sheet.command.set-table-data',
        ];

        if (commandsToWatch.includes(command.id)) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const workbook = facade.getActiveWorkbook();
            if (workbook) {
              const sheet = workbook.getActiveSheet();
              if (sheet) {
                // If row was inserted, try to apply formulas to the new row
                if (command.id === 'sheet.command.insert-row' && command.params) {
                  const rowIndex = command.params.range?.startRow || command.params.row;
                  if (typeof rowIndex === 'number') {
                    const r = rowIndex + 1; // 1-based for formulas
                    
                    // Apply Total Formula (Column F - index 5)
                    sheet.getRange(rowIndex, 5, 1, 1).setFormula(`=C${r+1}*E${r+1}`);
                    
                    // Apply Qty Formula for Time-Based (Column C - index 2)
                    if (sheetType === 'time-based') {
                      const cutoff = parseISO(project.cutoffDate);
                      const forecastColIndices: number[] = [];
                      phasingMonths.forEach((m, i) => {
                        const monthDate = parseISO(`20${m.split(' ')[1]}-${m.split(' ')[0]}-01`);
                        if (isAfter(monthDate, cutoff)) {
                          forecastColIndices.push(9 + i);
                        }
                      });
                      
                      if (forecastColIndices.length > 0) {
                        const startCol = getColumnName(forecastColIndices[0]);
                        const endCol = getColumnName(forecastColIndices[forecastColIndices.length - 1]);
                        sheet.getRange(rowIndex, 2, 1, 1).setFormula(`=SUM(${startCol}${r+1}:${endCol}${r+1})`);
                      }
                    }
                  }
                }

                const range = sheet.getRange(0, 0, 100, 30);
                if (range) {
                  const allValues = range.getValues();
                  const mappedData = mapUniverToData(allValues, data, sheetType, phasingMonths);
                  onDataChange(mappedData);
                }
              }
            }
          }, 500);
        }
      });
    } catch (error) {
      console.error('Univer Facade initialization failed:', error);
    }

    return () => {
      try {
        if (univerRef.current) {
          univerRef.current.dispose();
          univerRef.current = null;
        }
        if (unsubscribe && typeof unsubscribe.dispose === 'function') {
          unsubscribe.dispose();
        }
        window.removeEventListener('univer-create-table', handleManualCreateTable);
      } catch (e) {
        console.warn('Univer cleanup failed', e);
      }
    };
  }, [sheetId, sheetType, enterprise, phasingMonths]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div ref={containerRef} className="flex-1 univer-container" />
      <style>{`
        .univer-container {
          width: 100%;
          height: 100%;
          position: relative;
        }
        .univer-container .univer-app-layout {
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}

// Helper to map our row data to Univer's cellData format
const mapDataToUniver = (rows: any[], sheetType: string, phasingMonths: string[], project: Project) => {
  const cellData: any = {};
  
  // Headers
  const baseHeaders = ['Item', 'Item Description', 'Qty', 'Unit', 'Rate', 'Total', 'Category', 'Control Account', 'Order Number'];
  const headers = [...baseHeaders, ...phasingMonths];
  
  headers.forEach((header, col) => {
    if (!cellData[0]) cellData[0] = {};
    cellData[0][col] = { v: header, s: { bl: 1, bg: { rgb: '#f3f4f6' } } };
  });

  // Rows
  rows.forEach((row, r) => {
    const rowIndex = r + 1;
    if (!cellData[rowIndex]) cellData[rowIndex] = {};
    
    cellData[rowIndex][0] = { v: row.costCode || '' };
    cellData[rowIndex][1] = { v: row.description || '' };
    
    if (sheetType === 'commitment') {
      cellData[rowIndex][2] = { v: row.qty || 0, t: 2 };
    } else {
      // Qty formula for Time-Based: Sum of forecast phasing
      const cutoff = parseISO(project.cutoffDate);
      const forecastColIndices: number[] = [];
      phasingMonths.forEach((m, i) => {
        const monthDate = parseISO(`20${m.split(' ')[1]}-${m.split(' ')[0]}-01`);
        if (isAfter(monthDate, cutoff)) {
          forecastColIndices.push(9 + i);
        }
      });
      
      if (forecastColIndices.length > 0) {
        const startCol = getColumnName(forecastColIndices[0]);
        const endCol = getColumnName(forecastColIndices[forecastColIndices.length - 1]);
        cellData[rowIndex][2] = { f: `=SUM(${startCol}${rowIndex + 1}:${endCol}${rowIndex + 1})`, v: 0, t: 2 };
      } else {
        cellData[rowIndex][2] = { v: 0, t: 2 };
      }
    }
    
    cellData[rowIndex][3] = { v: row.unit || '' };
    cellData[rowIndex][4] = { v: row.rate || 0, t: 2 };
    
    // Total Formula: Qty * Rate (Column C * Column E)
    cellData[rowIndex][5] = { f: `=C${rowIndex + 1}*E${rowIndex + 1}`, v: 0, t: 2 };
    
    cellData[rowIndex][6] = { v: row.category || '' };
    cellData[rowIndex][7] = { v: row.controlAccount || '' };
    cellData[rowIndex][8] = { v: row.orderNumber || '' };

    // Phasing Columns
    phasingMonths.forEach((m, i) => {
      const colIndex = 9 + i;
      const val = row.timePhasing?.[m] || 0;
      cellData[rowIndex][colIndex] = { v: val, t: 2 };
    });
  });

  return cellData;
};

// Helper to map Univer's grid back to our row data
const mapUniverToData = (univerValues: any[][], originalRows: any[], sheetType: string, phasingMonths: string[]) => {
  const dataRows = univerValues.slice(1);
  const result = [];
  
  for (let i = 0; i < dataRows.length; i++) {
    const univerRow = dataRows[i];
    const isEmpty = !univerRow || univerRow.every(cell => !cell || (typeof cell === 'object' && !cell.v && !cell.f));
    
    if (isEmpty && i >= originalRows.length) continue;

    const originalRow = originalRows[i] || { id: crypto.randomUUID() };
    
    const getValue = (cell: any) => {
      if (!cell) return '';
      if (typeof cell === 'object') return cell.v !== undefined ? cell.v : '';
      return cell;
    };

    const timePhasing: Record<string, number> = {};
    phasingMonths.forEach((m, idx) => {
      timePhasing[m] = Number(getValue(univerRow[9 + idx])) || 0;
    });

    result.push({
      ...originalRow,
      costCode: String(getValue(univerRow[0])),
      description: String(getValue(univerRow[1])),
      qty: Number(getValue(univerRow[2])) || 0,
      unit: String(getValue(univerRow[3])),
      rate: Number(getValue(univerRow[4])) || 0,
      total: Number(getValue(univerRow[5])) || 0,
      category: String(getValue(univerRow[6])),
      controlAccount: String(getValue(univerRow[7])),
      orderNumber: String(getValue(univerRow[8])),
      timePhasing,
    });
  }
  
  return result;
};
