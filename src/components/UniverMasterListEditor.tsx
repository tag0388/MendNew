import React, { useEffect, useRef } from 'react';
import { Univer, UniverInstanceType, LocaleType } from '@univerjs/core';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { FUniver } from '@univerjs/core/facade';

import enUS from '@univerjs/ui/locale/en-US';
import enSheets from '@univerjs/sheets/locale/en-US';
import enSheetsUI from '@univerjs/sheets-ui/locale/en-US';
import enDesign from '@univerjs/design/locale/en-US';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';

interface MasterLists {
  categories: string[];
  controlAccounts: string[];
  orderNumbers: string[];
}

interface UniverMasterListEditorProps {
  data: MasterLists;
  onChange: (newData: MasterLists) => void;
}

export default function UniverMasterListEditor({ data, onChange }: UniverMasterListEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);

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
        },
      },
    });

    univerRef.current = univer;

    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container: containerRef.current,
      header: false,
      toolbar: true,
      footer: false,
    });

    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin);
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);

    // Prepare cell data
    const cellData: any = {
      0: {
        0: { v: 'Categories', s: { bl: 1, bg: { rgb: '#f3f4f6' } } },
        1: { v: 'Control Accounts', s: { bl: 1, bg: { rgb: '#f3f4f6' } } },
        2: { v: 'Order Numbers', s: { bl: 1, bg: { rgb: '#f3f4f6' } } },
      }
    };

    const maxRows = Math.max(data.categories.length, data.controlAccounts.length, data.orderNumbers.length, 50);
    for (let i = 0; i < maxRows; i++) {
      cellData[i + 1] = {
        0: { v: data.categories[i] || '' },
        1: { v: data.controlAccounts[i] || '' },
        2: { v: data.orderNumbers[i] || '' },
      };
    }

    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'master-lists',
      name: 'Master Lists',
      sheets: {
        'sheet1': {
          id: 'sheet1',
          name: 'Lists',
          cellData,
          rowCount: maxRows + 20,
          columnCount: 10,
        },
      },
    });

    const facade = FUniver.newAPI(univer);
    let debounceTimer: any = null;
    const unsubscribe = facade.onCommandExecuted((command: any) => {
      const commandsToWatch = [
        'sheet.command.set-range-values',
        'sheet.command.insert-row',
        'sheet.command.delete-row',
      ];

      if (commandsToWatch.includes(command.id)) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const workbook = facade.getActiveWorkbook();
          if (workbook) {
            const sheet = workbook.getActiveSheet();
            if (sheet) {
              const range = sheet.getRange(1, 0, maxRows + 20, 3);
              if (range) {
                const values = range.getValues();
                const newCategories: string[] = [];
                const newControlAccounts: string[] = [];
                const newOrderNumbers: string[] = [];

                values.forEach((row) => {
                  const getVal = (cell: any) => {
                    if (!cell) return '';
                    if (typeof cell === 'object') return cell.v !== undefined ? cell.v : '';
                    return cell;
                  };

                  const cat = getVal(row[0]);
                  const acc = getVal(row[1]);
                  const ord = getVal(row[2]);
                  
                  if (cat) newCategories.push(String(cat).trim());
                  if (acc) newControlAccounts.push(String(acc).trim());
                  if (ord) newOrderNumbers.push(String(ord).trim());
                });

                onChange({
                  categories: newCategories,
                  controlAccounts: newControlAccounts,
                  orderNumbers: newOrderNumbers,
                });
              }
            }
          }
        }, 500);
      }
    });

    return () => {
      univer.dispose();
      unsubscribe.dispose();
    };
  }, []);

  return (
    <div className="w-full h-[500px] border rounded-lg overflow-hidden flex flex-col">
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
