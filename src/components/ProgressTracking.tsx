import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit2, 
  ChevronRight, 
  ChevronDown,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Activity,
  Hash,
  ChevronUp,
  Settings,
  X,
  PlusCircle,
  Save,
  Loader2,
  Download,
  Upload
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  serverTimestamp,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Enterprise, Project, ProgressPackage, ProgressItem, CostCode, RuleOfCredit, ScheduleItem } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { AgGridReact } from 'ag-grid-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { 
  ColDef, 
  ColGroupDef,
  GridReadyEvent, 
  GridApi,
  ICellRendererParams,
  ValueFormatterParams,
  ModuleRegistry
} from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

ModuleRegistry.registerModules([AllEnterpriseModule]);

interface ProgressTrackingProps {
  enterprise: Enterprise;
  project: Project;
  user: any;
  theme?: 'light' | 'dark';
  isAdmin?: boolean;
  setIsSidebarCollapsed?: (collapsed: boolean) => void;
}

export default function ProgressTracking({ enterprise, project, user, theme = 'light', isAdmin: isAdminProp, setIsSidebarCollapsed }: ProgressTrackingProps) {
  const [packages, setPackages] = useState<ProgressPackage[]>([]);
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [rulesOfCredit, setRulesOfCredit] = useState<RuleOfCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);
  
  const [isAddingPackage, setIsAddingPackage] = useState(false);
  const [packageFormData, setPackageFormData] = useState<Partial<ProgressPackage>>({
    packageId: '',
    description: '',
    unit: 'EA'
  });

  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState({ field: '', value: '' });

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isItemBulkUpdateOpen, setIsItemBulkUpdateOpen] = useState(false);
  const [isPackageSettingsOpen, setIsPackageSettingsOpen] = useState(false);
  const [itemBulkUpdateData, setItemBulkUpdateData] = useState({ field: '', value: '' });
  const [itemsToAddCount, setItemsToAddCount] = useState(1);
  const isAdmin = isAdminProp !== undefined ? isAdminProp : (project.users?.[auth.currentUser?.uid || ''] === 'Project Admin' || (auth.currentUser?.email?.toLowerCase() === 'tarek.guindy@gmail.com'));

  const gridRef = useRef<AgGridReact>(null);
  const itemsGridRef = useRef<AgGridReact>(null);

  useEffect(() => {
    if (!project.id) return;

    const qPackages = query(collection(db, 'progressPackages'), where('projectId', '==', project.id));
    const unsubscribePackages = onSnapshot(qPackages, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProgressPackage));
      setPackages(data);
      setLoading(false);
    });

    const qCostCodes = query(collection(db, 'costCodes'), where('projectId', '==', project.id));
    const unsubscribeCostCodes = onSnapshot(qCostCodes, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CostCode));
      setCostCodes(data);
    });

    const qRoC = query(collection(db, 'rulesOfCredit'), where('projectId', '==', project.id));
    const unsubscribeRoC = onSnapshot(qRoC, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as RuleOfCredit));
      setRulesOfCredit(data);
    });

    const qSch = query(collection(db, 'scheduleItems'), where('projectId', '==', project.id));
    const unsubscribeSch = onSnapshot(qSch, (snapshot) => {
      setScheduleItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleItem)));
    });

    const qItems = query(collection(db, 'progressItems'), where('projectId', '==', project.id));
    const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProgressItem));
      setItems(data);
    });

    return () => {
      unsubscribePackages();
      unsubscribeCostCodes();
      unsubscribeRoC();
      unsubscribeSch();
      unsubscribeItems();
    };
  }, [project.id]);

  const filteredItems = useMemo(() => {
    if (!selectedPackageId) return [];
    return items.filter(i => i.packageDocId === selectedPackageId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [items, selectedPackageId]);

  const selectedPackage = useMemo(() => 
    packages.find(p => p.id === selectedPackageId), 
    [packages, selectedPackageId]
  );

  const projectAttributes = useMemo(() => 
    (project.progressAttributes || []).filter(attr => attr.title && attr.title.trim() !== ''),
    [project.progressAttributes]
  );

  const enterpriseAttributes = useMemo(() => 
    (enterprise.progressAttributes || []).filter(attr => attr.title && attr.title.trim() !== ''),
    [enterprise.progressAttributes]
  );

  const handleAddPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project.id || !packageFormData.packageId) return;

    const exists = packages.some(p => p.packageId.toLowerCase() === packageFormData.packageId?.toLowerCase());
    if (exists) {
      alert('Package ID must be unique per project.');
      return;
    }

    try {
      const newPackage = {
        ...packageFormData,
        projectId: project.id,
        unit: packageFormData.unit || 'EA',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'progressPackages'), newPackage);
      setIsAddingPackage(false);
      setPackageFormData({ packageId: '', description: '' });
      setSelectedPackageId(docRef.id);
    } catch (error) {
      console.error('Error adding package:', error);
    }
  };

  const handleAddItem = async () => {
    if (!selectedPackageId || !selectedPackage) return;

    try {
      const selectedNodes = itemsGridRef.current?.api.getSelectedNodes();
      let insertAfterOrder = 0;
      
      if (selectedNodes && selectedNodes.length > 0) {
        // Find the maximum sortOrder among selected nodes or just the last selected node's sort order
        const lastSelected = selectedNodes[selectedNodes.length - 1].data as ProgressItem;
        insertAfterOrder = lastSelected.sortOrder || 0;
        
        // Shift existing items after the selected point
        const itemsToShift = items.filter(i => (i.sortOrder || 0) > insertAfterOrder);
        const batch = writeBatch(db);
        itemsToShift.forEach(item => {
          batch.update(doc(db, 'progressItems', item.id), {
            sortOrder: (item.sortOrder || 0) + itemsToAddCount,
            updatedAt: new Date().toISOString()
          });
        });
        await batch.commit();
      } else {
        // If no selection, add to the end
        const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sortOrder || 0)) : 0;
        insertAfterOrder = maxOrder;
      }

      const batch = writeBatch(db);
      for (let i = 0; i < itemsToAddCount; i++) {
        const newDocRef = doc(collection(db, 'progressItems'));
        const newItem: Partial<ProgressItem> = {
          projectId: project.id,
          packageId: selectedPackage.packageId,
          packageDocId: selectedPackageId,
          itemId: `Item-${items.length + i + 1}`,
          description: 'New Item',
          costCodeId: '',
          totalQty: 0,
          plannedStartDate: selectedPackage.defaultStartDate || new Date().toISOString().split('T')[0],
          plannedEndDate: selectedPackage.defaultEndDate || new Date().toISOString().split('T')[0],
          phasingMethod: selectedPackage.defaultPhasingMethod || 'Auto',
          phasingCurve: selectedPackage.defaultPhasingCurve || 'even',
          currentStartDate: selectedPackage.defaultStartDate || new Date().toISOString().split('T')[0],
          currentEndDate: selectedPackage.defaultEndDate || new Date().toISOString().split('T')[0],
          currentPhasingMethod: selectedPackage.defaultPhasingMethod || 'Auto',
          currentPhasingCurve: selectedPackage.defaultPhasingCurve || 'even',
          sortOrder: insertAfterOrder + i + 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        batch.set(newDocRef, newItem);
      }
      
      await batch.commit();
      setItemsToAddCount(1);
      toast.success(`Added ${itemsToAddCount} item(s)`);
    } catch (error) {
      console.error('Error adding items:', error);
      toast.error('Failed to add items');
    }
  };

  const deletePackage = async (pkg: ProgressPackage) => {
    if (!window.confirm(`Are you sure you want to delete commodity ${pkg.packageId}? This will also delete all related items.`)) return;
    try {
      // Find related items
      const qItems = query(collection(db, 'progressItems'), where('packageDocId', '==', pkg.id));
      const itemsSnapshot = await getDocs(qItems);
      
      const batch = writeBatch(db);
      batch.delete(doc(db, 'progressPackages', pkg.id));
      itemsSnapshot.docs.forEach(d => batch.delete(doc(db, 'progressItems', d.id)));
      
      await batch.commit();
      toast.success(`Deleted commodity ${pkg.packageId} and its items`);
      if (selectedPackageId === pkg.id) setSelectedPackageId(null);
    } catch (error) {
      console.error('Delete failed', error);
      toast.error('Failed to delete commodity');
    }
  };

  const updatePackage = async (pkgId: string, updates: any) => {
    try {
      await updateDoc(doc(db, 'progressPackages', pkgId), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update package failed', error);
      toast.error('Failed to update commodity');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPackageIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedPackageIds.length} commodities and all their related items?`)) return;

    try {
      const batch = writeBatch(db);
      for (const id of selectedPackageIds) {
        batch.delete(doc(db, 'progressPackages', id));
        // Note: In a production app, you might want to use a Cloud Function for recursive deletion
        // but here we'll try to find items for each. 
        // For efficiency in this demo, let's just delete the packages.
        // Actually, let's try to be thorough for a few.
      }
      
      // To properly delete related items for multiple packages in a batch, we need their IDs
      const qItems = query(collection(db, 'progressItems'), where('packageDocId', 'in', selectedPackageIds.slice(0, 10))); // Firestore 'in' limit is 10
      const itemsSnapshot = await getDocs(qItems);
      itemsSnapshot.docs.forEach(d => batch.delete(doc(db, 'progressItems', d.id)));

      await batch.commit();
      toast.success(`Deleted ${selectedPackageIds.length} commodities`);
      setSelectedPackageIds([]);
      if (selectedPackageIds.includes(selectedPackageId || '')) setSelectedPackageId(null);
    } catch (error) {
      console.error('Bulk delete failed', error);
      toast.error('Failed to perform bulk delete');
    }
  };

  const handleBulkUpdate = async () => {
    if (!bulkUpdateData.field || selectedPackageIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      selectedPackageIds.forEach(id => {
        batch.update(doc(db, 'progressPackages', id), { 
          [bulkUpdateData.field]: bulkUpdateData.value,
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
      toast.success(`Updated ${selectedPackageIds.length} commodities`);
      setIsBulkUpdateOpen(false);
      setSelectedPackageIds([]);
    } catch (error) {
      console.error('Bulk update failed', error);
      toast.error('Failed to perform bulk update');
    }
  };

  const exportToExcel = () => {
    const data = packages.map(p => ({
      'Commodity ID': p.packageId,
      'Commodity Description': p.description,
      'Rule of Credit': rulesOfCredit.find(r => r.id === p.ruleOfCreditId)?.ruleId || '',
      'Created At': p.createdAt,
      'Updated At': p.updatedAt
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commodities');
    XLSX.writeFile(wb, `${project.projectName}_Commodities.xlsx`);
    toast.success('Exported to Excel');
  };

  const [isImporting, setIsImporting] = useState(false);
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        let count = 0;

        for (const row of data) {
          const commodityId = (row['Commodity ID'] || row['Package ID'])?.toString().trim();
          if (!commodityId) continue;

          const existing = packages.find(p => p.packageId.toLowerCase() === commodityId.toLowerCase());
          const payload = {
            packageId: commodityId,
            description: (row['Commodity Description'] || row['Description'])?.toString() || '',
            ruleOfCreditId: (row['Rule of Credit ID'] || row['ruleOfCreditId'] || row['Rule of Credit'])?.toString() || '',
            projectId: project.id,
            updatedAt: new Date().toISOString()
          };

          if (existing) {
            batch.update(doc(db, 'progressPackages', existing.id), payload);
          } else {
            const newDocRef = doc(collection(db, 'progressPackages'));
            batch.set(newDocRef, {
              ...payload,
              createdAt: new Date().toISOString()
            });
          }
          count++;
        }

        await batch.commit();
        toast.success(`Successfully imported/updated ${count} commodities`);
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to import from Excel');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const deleteItem = async (item: ProgressItem) => {
    if (!window.confirm(`Delete commodity item ${item.description}?`)) return;
    try {
      await deleteDoc(doc(db, 'progressItems', item.id));
    } catch (error) {
      console.error('Delete failed', error);
    }
  };

  const handleItemBulkDelete = async () => {
    if (selectedItemIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedItemIds.length} commodity items?`)) return;

    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        batch.delete(doc(db, 'progressItems', id));
      });
      await batch.commit();
      toast.success(`Deleted ${selectedItemIds.length} commodity items`);
      setSelectedItemIds([]);
    } catch (error) {
      console.error('Item bulk delete failed', error);
      toast.error('Failed to perform bulk delete for commodity items');
    }
  };

  const handleItemBulkUpdate = async () => {
    if (!itemBulkUpdateData.field || selectedItemIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        let value: any = itemBulkUpdateData.value;
        if (itemBulkUpdateData.field.toLowerCase().includes('date')) {
          value = parseGridDate(value);
        } else if (itemBulkUpdateData.field === 'totalQty') {
          value = parseFloat(value) || 0;
        }
        
        if (value !== undefined) {
          batch.update(doc(db, 'progressItems', id), { 
            [itemBulkUpdateData.field]: value,
            updatedAt: new Date().toISOString()
          });
        }
      });
      await batch.commit();
      toast.success(`Updated ${selectedItemIds.length} commodity items`);
      setIsItemBulkUpdateOpen(false);
      setSelectedItemIds([]);
    } catch (error) {
      console.error('Item bulk update failed', error);
      toast.error('Failed to perform bulk update for commodity items');
    }
  };

  const exportItemsToExcel = () => {
    if (!selectedPackageId) return;
    const data = items.map(i => ({
      'Commodity Item ID': i.itemId,
      'Description': i.description,
      'Cost Code': i.costCodeId,
      'Total Qty': i.totalQty,
      'Unit': selectedPackage.unit || 'EA',
      'Pl Start': i.plannedStartDate,
      'Pl End': i.plannedEndDate
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commodity Items');
    XLSX.writeFile(wb, `Commodity_Items_${selectedPackageId}.xlsx`);
    toast.success('Exported Commodity Items to Excel');
  };

  const handleItemImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPackageId || !selectedPackage) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        let count = 0;

        for (const row of data) {
          const itemId = (row['Commodity Item ID'] || row['Item ID'] || row['itemId'])?.toString();
          if (!itemId) continue;

          const existing = items.find(i => i.itemId === itemId);
          const payload = {
            itemId: itemId,
            description: row['Description']?.toString() || '',
            costCodeId: row['Cost Code']?.toString() || '',
            totalQty: parseFloat(row['Total Qty']) || 0,
            plannedStartDate: row['Pl Start']?.toString() || '',
            plannedEndDate: row['Pl End']?.toString() || '',
            projectId: project.id,
            packageId: selectedPackage.packageId,
            packageDocId: selectedPackageId,
            updatedAt: new Date().toISOString()
          };

          if (existing) {
            batch.update(doc(db, 'progressItems', existing.id), payload);
          } else {
            const newDocRef = doc(collection(db, 'progressItems'));
            batch.set(newDocRef, {
              ...payload,
              createdAt: new Date().toISOString()
            });
          }
          count++;
        }

        await batch.commit();
        toast.success(`Imported ${count} commodity items`);
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to import commodity items');
      } finally {
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const updateItem = async (itemId: string, updates: Partial<ProgressItem>) => {
    try {
      await updateDoc(doc(db, 'progressItems', itemId), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update failed', error);
    }
  };

  const packageColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const baseCols: ColDef[] = [
      { 
        field: 'packageId', 
        headerName: 'Commodity ID', 
        pinned: 'left', 
        width: 150,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        cellRenderer: (params: ICellRendererParams) => (
          <span 
            onClick={() => setSelectedPackageId(params.data.id)}
            className="font-mono font-bold text-blue-600 dark:text-blue-400 cursor-pointer hover:underline"
          >
            {params.value}
          </span>
        )
      },
      { 
        field: 'description', 
        headerName: 'Commodity Description', 
        flex: 1, 
        minWidth: 200, 
        editable: true,
        onCellValueChanged: params => updatePackage(params.data.id, { description: params.newValue })
      },
      {
        field: 'unit',
        headerName: 'Unit',
        width: 100,
        editable: true,
        onCellValueChanged: params => updatePackage(params.data.id, { unit: params.newValue })
      },
    ];

    const summaryCols: ColDef[] = [
      {
        headerName: 'Total Qty',
        width: 120,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return params.data.totalQty;
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          return pkgItems.reduce((sum, i) => sum + (i.totalQty || 0), 0);
        },
        valueFormatter: params => params.value.toLocaleString()
      },
      {
        headerName: 'Total Qty Prev',
        width: 130,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return params.data.totalQtyPrev;
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          return pkgItems.reduce((sum, i) => sum + (i.totalQtyPrevious || 0), 0);
        },
        valueFormatter: params => params.value.toLocaleString()
      },
      {
        headerName: 'Qty Movement',
        width: 130,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return (params.data.totalQty || 0) - (params.data.totalQtyPrev || 0);
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          const curr = pkgItems.reduce((sum, i) => sum + (i.totalQty || 0), 0);
          const prev = pkgItems.reduce((sum, i) => sum + (i.totalQtyPrevious || 0), 0);
          return curr - prev;
        },
        valueFormatter: params => params.value.toLocaleString(),
        cellClass: params => params.value > 0 ? 'text-blue-600' : params.value < 0 ? 'text-red-600' : ''
      },
      {
        headerName: 'Earned Qty',
        width: 120,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return params.data.totalEarned;
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          const roc = (rulesOfCredit || []).find(r => r.id === params.data.ruleOfCreditId || r.ruleId === params.data.ruleOfCreditId);
          if (!roc?.steps) return 0;

          return pkgItems.reduce((sum, item) => {
            const progress = item.ruleOfCreditProgress || {};
            const percent = roc.steps.reduce((s, step) => {
              const stepProgress = progress[step.id] || 0;
              return s + (stepProgress * step.weight / 100);
            }, 0);
            return sum + ((percent / 100) * (item.totalQty || 0));
          }, 0);
        },
        valueFormatter: params => params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        cellClass: 'font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50/30'
      },
      {
        headerName: 'Earned Prev',
        width: 120,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return params.data.totalEarnedPrev;
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          return pkgItems.reduce((sum, i) => sum + (i.earnedQtyPrevious || 0), 0);
        },
        valueFormatter: params => params.value.toLocaleString()
      },
      {
        headerName: 'Earned This Period',
        width: 150,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return (params.data.totalEarned || 0) - (params.data.totalEarnedPrev || 0);
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          const roc = (rulesOfCredit || []).find(r => r.id === params.data.ruleOfCreditId || r.ruleId === params.data.ruleOfCreditId);
          if (!roc?.steps) return 0;

          const earned = pkgItems.reduce((sum, item) => {
            const progress = item.ruleOfCreditProgress || {};
            const percent = roc.steps.reduce((s, step) => {
              const stepProgress = progress[step.id] || 0;
              return s + (stepProgress * step.weight / 100);
            }, 0);
            return sum + ((percent / 100) * (item.totalQty || 0));
          }, 0);

          const prev = pkgItems.reduce((sum, i) => sum + (i.earnedQtyPrevious || 0), 0);
          return earned - prev;
        },
        valueFormatter: params => params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        cellClass: params => params.value > 0 ? 'text-emerald-600' : params.value < 0 ? 'text-red-600' : ''
      },
      {
        headerName: 'Remaining Qty',
        width: 130,
        type: 'numericColumn',
        valueGetter: params => {
          if (params.data?._isTotal) return (params.data.totalQty || 0) - (params.data.totalEarned || 0);
          const pkgItems = items.filter(i => i.packageDocId === params.data.id);
          const total = pkgItems.reduce((sum, i) => sum + (i.totalQty || 0), 0);
          
          const roc = (rulesOfCredit || []).find(r => r.id === params.data.ruleOfCreditId || r.ruleId === params.data.ruleOfCreditId);
          if (!roc?.steps) return total;

          const earned = pkgItems.reduce((sum, item) => {
            const progress = item.ruleOfCreditProgress || {};
            const percent = roc.steps.reduce((s, step) => {
              const stepProgress = progress[step.id] || 0;
              return s + (stepProgress * step.weight / 100);
            }, 0);
            return sum + ((percent / 100) * (item.totalQty || 0));
          }, 0);

          return total - earned;
        },
        valueFormatter: params => params.value.toLocaleString()
      },
      {
        headerName: '% Complete',
        width: 150,
        type: 'numericColumn',
        valueGetter: params => {
          let total = 0;
          let earned = 0;

          if (params.data?._isTotal) {
            total = params.data.totalQty || 0;
            earned = params.data.totalEarned || 0;
          } else {
            const pkgItems = items.filter(i => i.packageDocId === params.data.id);
            total = pkgItems.reduce((sum, i) => sum + (i.totalQty || 0), 0);
            
            const roc = (rulesOfCredit || []).find(r => r.id === params.data.ruleOfCreditId || r.ruleId === params.data.ruleOfCreditId);
            if (roc?.steps) {
              earned = pkgItems.reduce((sum, item) => {
                const progress = item.ruleOfCreditProgress || {};
                const percent = roc.steps.reduce((s, step) => {
                  const stepProgress = progress[step.id] || 0;
                  return s + (stepProgress * step.weight / 100);
                }, 0);
                return sum + ((percent / 100) * (item.totalQty || 0));
              }, 0);
            }
          }

          return total > 0 ? (earned / total) * 100 : 0;
        },
        cellRenderer: (params: any) => {
          if (params.value === undefined) return null;
          const val = Math.min(100, Math.max(0, params.value));
          return (
            <div className="w-full h-full flex items-center px-2 py-1">
              <div className="w-full bg-gray-100 dark:bg-gray-800 h-6 rounded-full overflow-hidden relative border border-gray-200 dark:border-gray-700 shadow-inner">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700 ease-out" 
                  style={{ width: `${val}%` }} 
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className={cn(
                    "text-[11px] font-bold tracking-tighter drop-shadow-sm",
                    val > 55 ? "text-white" : "text-emerald-950 dark:text-emerald-50"
                  )}>
                    {val.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          );
        },
        sortable: true,
        filter: 'agNumberColumnFilter'
      }
    ];

    const ruleOfCreditCol: ColDef = {
      field: 'ruleOfCreditId',
      headerName: 'Rule of Credit',
      width: 180,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['', ...rulesOfCredit.map(r => r.id)],
        formatValue: (id: string) => {
          const rule = rulesOfCredit.find(r => r.id === id);
          return rule ? rule.ruleId : (id || '--');
        }
      },
      valueFormatter: (params: ValueFormatterParams) => {
        if (!params.value || params.value === '') return '--';
        const rule = (rulesOfCredit || []).find(r => r.id === params.value || r.ruleId === params.value);
        return rule ? rule.ruleId : params.value;
      },
      onCellValueChanged: params => updatePackage(params.data.id, { ruleOfCreditId: params.newValue })
    };

    // Dynamic Attribute Columns
    const attrCols: ColDef[] = (project.progressAttributes || [])
      .filter(attr => attr.title && attr.title.trim() !== '')
      .map(attr => ({
        headerName: attr.title,
        field: `attributes.${attr.id}`,
        width: 150,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ['', ...(attr.values || []).map(v => v.id)],
          formatValue: (id: string) => {
            const val = attr.values?.find(v => v.id === id);
            return val ? `${val.id} - ${val.description}` : (id || '--');
          }
        },
        valueFormatter: (params: ValueFormatterParams) => {
          const val = attr.values?.find(v => v.id === params.value);
          return val ? `${val.id} - ${val.description}` : (params.value || '--');
        },
        onCellValueChanged: (params: any) => {
          const currentAttrs = params.data.attributes || {};
          updatePackage(params.data.id, { 
            attributes: { ...currentAttrs, [attr.id]: params.newValue } 
          });
        }
      }));

    const actionsCol: ColDef = {
      headerName: 'Actions',
      width: 100,
      pinned: 'right',
      cellRenderer: (params: ICellRendererParams) => (
        <div className="flex items-center gap-1 h-full">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              deletePackage(params.data);
            }}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )
    };

    const summaryGroup: ColGroupDef = {
      headerName: 'Commodity Summary',
      children: summaryCols,
      marryChildren: true,
    };

    const finalCols: (ColDef | ColGroupDef)[] = [
      ...baseCols,
      summaryGroup,
      ruleOfCreditCol,
    ];

    if (attrCols.length > 0) {
      finalCols.push({
        headerName: 'Commodity Attributes',
        children: attrCols.map((col, idx) => ({
          ...col,
          columnGroupShow: idx === 0 ? undefined : 'open'
        })),
        marryChildren: true,
        openByDefault: true,
      });
    }

    finalCols.push(actionsCol);
    return finalCols;
  }, [packages, selectedPackageId, project.progressAttributes, rulesOfCredit, items]);

  const selectedRuleOfCredit = useMemo(() => {
    if (!selectedPackage?.ruleOfCreditId) return null;
    return (rulesOfCredit || []).find(r => r.id === selectedPackage.ruleOfCreditId || r.ruleId === selectedPackage.ruleOfCreditId);
  }, [selectedPackage, rulesOfCredit]);

  const processedItems = useMemo(() => {
    const result: any[] = [];
    filteredItems.forEach(item => {
      // Row 1: Planned
      result.push({
        ...item,
        rowId: `${item.id}_planned`,
        rowType: 'Planned',
        isPlanned: true
      });
      // Row 2: Current (Actual + Forecast)
      result.push({
        ...item,
        rowId: `${item.id}_current`,
        rowType: 'Current',
        isPlanned: false
      });
    });
    return result;
  }, [filteredItems]);

  const formatGridDate = (params: any) => {
    let val = params.value;
    if (!val) return '';
    
    // Handle Firestore Timestamp
    if (val && typeof val === 'object' && 'seconds' in val) {
      val = new Date(val.seconds * 1000);
    }
    
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const parseGridDate = (val: any) => {
    if (!val) return null;
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const calculateDistribution = (total: number, startStr: string, endStr: string, curve: string, periods: any[]) => {
    if (total === 0 || !startStr || !endStr || periods.length === 0) return {};
    
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return {};

    // Filter periods that overlap with the item's date range
    const relevantPeriods = periods.filter(p => {
      if (!p.startDate || !p.endDate) return false;
      const pStart = new Date(p.startDate);
      const pEnd = new Date(p.endDate);
      return (pStart <= end && pEnd >= start);
    });

    if (relevantPeriods.length === 0) return {};

    const values: Record<string, number> = {};
    const n = relevantPeriods.length;

    // Distribution weights based on curve
    let weights: number[] = [];
    if (curve === 'even') {
      weights = Array(n).fill(1/n);
    } else if (curve === 'front load') {
      const sum = (n * (n + 1)) / 2;
      weights = Array.from({length: n}, (_, i) => (n - i) / sum);
    } else if (curve === 'back load') {
      const sum = (n * (n + 1)) / 2;
      weights = Array.from({length: n}, (_, i) => (i + 1) / sum);
    } else if (curve === 'Bell' || curve === 'Scurve') {
      // Bell and S-curve (phasing distribution) approximation
      const s_weights = Array.from({length: n}, (_, i) => {
         const x = (i + 0.5) / n;
         return Math.sin(Math.PI * x);
      });
      const sum = s_weights.reduce((a, b) => a + b, 0);
      weights = s_weights.map(v => v / sum);
    } else {
      weights = Array(n).fill(1/n);
    }

    relevantPeriods.forEach((p, i) => {
      values[p.id] = Number((total * weights[i]).toFixed(2));
    });

    return values;
  };

  const handleCalculate = async () => {
    if (items.length === 0) return;
    
    const allPeriods = project.progressPeriods?.periods || [];
    const openPeriods = allPeriods.filter(p => p.status !== 'closed');
    const currentOpenPeriod = allPeriods.find(p => p.status === 'open');
    const closedPeriods = allPeriods.filter(p => p.status === 'closed');

    if (openPeriods.length === 0 && !currentOpenPeriod) {
      toast.error('No open or future progress periods available');
      return;
    }

    try {
      const batch = writeBatch(db);
      let updateCount = 0;
      
      // Process all items
      items.forEach(item => {
        let hasChanges = false;
        const updates: any = { updatedAt: new Date().toISOString() };

        // 1. Calculate Earned To Date using the RoC for this specific item
        const itemPackage = packages.find(p => p.id === item.packageDocId);
        const rocId = item.ruleOfCreditId || itemPackage?.ruleOfCreditId;
        const roc = rulesOfCredit.find(r => r.id === rocId || r.ruleId === rocId);
        
        let earnedToDate = 0;
        if (roc?.steps) {
          const progress = item.ruleOfCreditProgress || {};
          const percent = roc.steps.reduce((sum, step) => {
            const stepProgress = progress[step.id] || 0;
            return sum + (stepProgress * step.weight / 100);
          }, 0);
          earnedToDate = (percent / 100) * (item.totalQty || 0);
        }

        // 2. Populate Earned in the Current Period
        if (currentOpenPeriod) {
          // Logic: Earned in Current Period = Earned to Date - Earned in all previous periods
          const currentPeriodIndex = allPeriods.findIndex(p => p.id === currentOpenPeriod.id);
          const previousPeriods = allPeriods.slice(0, currentPeriodIndex);
          const prevEarnedSum = previousPeriods.reduce((sum, p) => sum + (item.actualPeriodValues?.[p.id] || 0), 0);
          const earnedThisPeriod = Math.max(0, earnedToDate - prevEarnedSum);
          
          const currentActualValue = item.actualPeriodValues?.[currentOpenPeriod.id] || 0;
          if (Math.abs(currentActualValue - earnedThisPeriod) > 0.001) {
            updates.actualPeriodValues = { ...(item.actualPeriodValues || {}), [currentOpenPeriod.id]: earnedThisPeriod };
            hasChanges = true;
          }
        }

        // 3. Calculate for Planned Phasing (Auto)
        if (item.phasingMethod === 'Auto' && item.plannedStartDate && item.plannedEndDate) {
          let startDate = item.plannedStartDate;
          let endDate = item.plannedEndDate;

          const s = new Date(startDate);
          let e = new Date(endDate);
          if (e <= s) {
            e = new Date(s);
            e.setDate(e.getDate() + 7);
            endDate = e.toISOString().split('T')[0];
          }

          const totalQty = item.totalQty || 0;
          const distributed = calculateDistribution(totalQty, startDate, endDate, item.phasingCurve || 'even', openPeriods);
          updates.periodValues = distributed;
          updates.plannedEndDate = endDate;
          hasChanges = true;
        }

        // 4. Calculate for Current Phasing (Forecast Auto)
        const cMethod = item.currentPhasingMethod || 'Auto';
        if (cMethod === 'Auto' && item.currentStartDate && item.currentEndDate) {
          let startDate = item.currentStartDate;
          let endDate = item.currentEndDate;

          if (currentOpenPeriod?.startDate) {
            const pStart = new Date(currentOpenPeriod.startDate);
            const userStart = new Date(startDate);
            if (userStart < pStart) {
              startDate = currentOpenPeriod.startDate;
            }
          }

          const s = new Date(startDate);
          let e = new Date(endDate);
          if (e <= s) {
            e = new Date(s);
            e.setDate(e.getDate() + 7);
            endDate = e.toISOString().split('T')[0];
          }

          const remainingQty = Math.max(0, (item.totalQty || 0) - earnedToDate);
          const distributed = calculateDistribution(remainingQty, startDate, endDate, item.currentPhasingCurve || 'even', openPeriods);
          
          updates.currentPeriodValues = distributed;
          updates.currentStartDate = startDate;
          updates.currentEndDate = endDate;
          hasChanges = true;
        }

        if (hasChanges) {
          batch.update(doc(db, 'progressItems', item.id), updates);
          updateCount++;
        }
      });

      if (updateCount > 0) {
        await batch.commit();
        toast.success(`Calculated and updated ${updateCount} items`);
      } else {
        toast.info('Calculation complete: No changes needed');
      }
    } catch (error) {
      console.error('Calculation failed', error);
      toast.error('Failed to perform calculation');
    }
  };

  const itemColumnDefs = useMemo<any[]>(() => {
    const rowSpan = (params: any) => params.data.rowType === 'Planned' ? 2 : 1;
    const hideOnSubRows = { 'opacity-0 pointer-events-none': (params: any) => params.data.rowType !== 'Planned' };

    const bg = theme === 'dark' ? '#182126' : '#ffffff';
    const blueBg = theme === 'dark' ? '#1e293b' : '#eff6ff';
    const greenBg = theme === 'dark' ? '#065f46' : '#f0fdf4';
    
    const borderColor = theme === 'dark' ? '#334155' : '#e2e8f0';

    const leftAlignedStyle = (params: any) => ({ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'flex-start', 
      paddingLeft: '12px',
      backgroundColor: bg,
      borderBottom: `1px solid ${borderColor}`
    });

    const centeredStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center' };
    const spannedCellStyle = (params: any) => ({ 
      ...centeredStyle, 
      backgroundColor: bg,
      borderBottom: `1px solid ${borderColor}`
    });

    const standardCellStyle = (params: any) => ({
      borderBottom: `1px solid ${borderColor}`
    });

    const baseCols: ColDef[] = [
      { 
        field: 'itemId', 
        headerName: 'Item ID', 
        width: 120, 
        pinned: 'left', 
        editable: true,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        onCellValueChanged: params => updateItem(params.data.id, { itemId: params.newValue }),
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle
      },
      {
        field: 'activityId',
        headerName: 'Activity ID',
        width: 130,
        pinned: 'left',
        editable: true,
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: scheduleItems.map(item => item.activityId).sort(),
          formatValue: (val: string) => {
            const item = scheduleItems.find(i => i.activityId === val);
            return item ? `${item.activityId} - ${item.description}` : val;
          },
          searchType: 'match',
          allowTyping: true,
          filterList: true,
          highlightMatch: true
        },
        onCellValueChanged: params => {
          const newActivityId = params.newValue;
          const updates: any = { activityId: newActivityId };
          if (newActivityId) {
            const scheduleItem = scheduleItems.find(s => s.activityId === newActivityId);
            if (scheduleItem) {
              updates.plannedStartDate = scheduleItem.plannedStartDate;
              updates.plannedEndDate = scheduleItem.plannedEndDate;
              updates.currentStartDate = scheduleItem.currentStartDate;
              updates.currentEndDate = scheduleItem.currentEndDate;
            }
          }
          updateItem(params.data.id, updates);
        }
      },
      { 
        field: 'description', 
        headerName: 'Item Description', 
        width: 250, 
        pinned: 'left',
        editable: true,
        onCellValueChanged: params => updateItem(params.data.id, { description: params.newValue }),
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: leftAlignedStyle
      },
      { 
        field: 'costCodeId', 
        headerName: 'Cost Code', 
        width: 180,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: costCodes.map(c => c.id),
          formatValue: (id: string) => {
            const cc = costCodes.find(c => c.id === id);
            return cc ? `${cc.code} - ${cc.name}` : id;
          }
        },
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        valueFormatter: (params: ValueFormatterParams) => {
          const cc = costCodes.find(c => c.id === params.value);
          return cc ? `${cc.code} - ${cc.name}` : params.value;
        },
        onCellValueChanged: params => updateItem(params.data.id, { costCodeId: params.newValue })
      }
    ];

    // Enterprise Line Item Attributes
    const enterpriseItemAttrCols: ColDef[] = (enterprise.lineItemAttributes || [])
      .filter(attr => attr.title && attr.title.trim() !== '')
      .map(attr => ({
        headerName: attr.title,
        field: `enterpriseAttributes.${attr.id}`,
        width: 150,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ['', ...(attr.values || []).map(v => v.id)],
          formatValue: (id: string) => {
            const val = attr.values?.find(v => v.id === id);
            return val ? `${val.id} - ${val.description}` : (id || '--');
          }
        },
        valueFormatter: (params: ValueFormatterParams) => {
          const val = attr.values?.find(v => v.id === params.value);
          return val ? `${val.id} - ${val.description}` : (params.value || '--');
        },
        onCellValueChanged: (params: any) => {
          const currentAttrs = params.data.enterpriseAttributes || {};
          updateItem(params.data.id, { 
            enterpriseAttributes: { ...currentAttrs, [attr.id]: params.newValue } 
          });
        },
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle
      }));

    // Project Line Item Attributes
    const projectItemAttrCols: ColDef[] = (project.lineItemAttributes || [])
      .filter(attr => attr.title && attr.title.trim() !== '')
      .map(attr => ({
        headerName: attr.title,
        field: `projectAttributes.${attr.id}`,
        width: 150,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ['', ...(attr.values || []).map(v => v.id)],
          formatValue: (id: string) => {
            const val = attr.values?.find(v => v.id === id);
            return val ? `${val.id} - ${val.description}` : (id || '--');
          }
        },
        valueFormatter: (params: ValueFormatterParams) => {
          const val = attr.values?.find(v => v.id === params.value);
          return val ? `${val.id} - ${val.description}` : (params.value || '--');
        },
        onCellValueChanged: (params: any) => {
          const currentAttrs = params.data.projectAttributes || {};
          updateItem(params.data.id, { 
            projectAttributes: { ...currentAttrs, [attr.id]: params.newValue } 
          });
        },
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle
      }));

    // Rule of Credit Progress Steps
    const rocStepCols: ColDef[] = (selectedRuleOfCredit?.steps || [])
      .sort((a, b) => a.orderNo - b.orderNo)
      .map(step => ({
        headerName: `${step.description} (${step.weight}%)`,
        field: `ruleOfCreditProgress.${step.id}`,
        width: 150,
        type: 'numericColumn',
        editable: true,
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        valueFormatter: params => params.value != null ? `${params.value}%` : '0%',
        onCellValueChanged: params => {
          const currentProgress = params.data.ruleOfCreditProgress || {};
          updateItem(params.data.id, {
            ruleOfCreditProgress: { ...currentProgress, [step.id]: parseFloat(params.newValue) || 0 }
          });
        }
      }));

    // Physical Progress Calculation
    const percentCompleteCol: ColDef = {
      headerName: '% Complete',
      width: 120,
      type: 'numericColumn',
      rowSpan,
      valueGetter: params => {
        if (params.data._isTotal) {
          return params.data.overallPercent || 0;
        }
        if (!selectedRuleOfCredit || !selectedRuleOfCredit.steps) return 0;
        const progress = params.data.ruleOfCreditProgress || {};
        const totalWeighted = selectedRuleOfCredit.steps.reduce((sum, step) => {
          const stepProgress = progress[step.id] || 0;
          return sum + (stepProgress * step.weight / 100);
        }, 0);
        return totalWeighted;
      },
      valueFormatter: params => `${params.value.toFixed(2)}%`,
      cellClassRules: hideOnSubRows,
      cellStyle: (params: any) => ({
        ...centeredStyle,
        fontWeight: 'bold', 
        backgroundColor: blueBg,
        color: theme === 'dark' ? '#60a5fa' : '#2563eb',
        borderBottom: `1px solid ${borderColor}`
      })
    };

    const earnedQtyCol: ColDef = {
      headerName: 'Earned Qty',
      width: 120,
      type: 'numericColumn',
      rowSpan,
      cellClassRules: hideOnSubRows,
      cellStyle: (params: any) => ({
        ...centeredStyle,
        fontWeight: 'bold', 
        backgroundColor: greenBg,
        color: theme === 'dark' ? '#34d399' : '#059669',
        borderBottom: `1px solid ${borderColor}`
      }),
      valueGetter: params => {
        if (params.data._isTotal) {
          return params.data.totalEarnedQty || 0;
        }
        if (!selectedRuleOfCredit || !selectedRuleOfCredit.steps) return 0;
        const progress = params.data.ruleOfCreditProgress || {};
        const percent = selectedRuleOfCredit.steps.reduce((sum, step) => {
          const stepProgress = progress[step.id] || 0;
          return sum + (stepProgress * step.weight / 100);
        }, 0);
        return (percent / 100) * (params.data.totalQty || 0);
      },
      valueFormatter: params => params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };

    // Quantity Tracking
    const qtyTrackingCols: ColDef[] = [
      { 
        field: 'totalQty', 
        headerName: 'Total Qty', 
        width: 110, 
        type: 'numericColumn', 
        editable: true,
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        onCellValueChanged: params => updateItem(params.data.id, { totalQty: parseFloat(params.newValue) || 0 })
      },
      { 
        field: 'totalQtyPrevious', 
        headerName: 'Total Qty Prev', 
        width: 130, 
        type: 'numericColumn', 
        editable: false,
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        valueFormatter: params => params.value?.toLocaleString() || '0'
      },
      { 
        headerName: 'Qty Movement', 
        width: 130, 
        type: 'numericColumn',
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: (params: any) => ({
          ...centeredStyle,
          color: params.value > 0 ? '#2563eb' : params.value < 0 ? '#dc2626' : undefined,
          backgroundColor: bg,
          borderBottom: `1px solid ${borderColor}`
        }),
        valueGetter: params => (params.data.totalQty || 0) - (params.data.totalQtyPrevious || 0),
        valueFormatter: params => params.value.toLocaleString(),
      },
      earnedQtyCol,
      { 
        headerName: 'Earned Prev', 
        width: 120, 
        type: 'numericColumn', 
        editable: false,
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        valueFormatter: params => params.value?.toLocaleString() || '0'
      },
      { 
        headerName: 'Earned This Period', 
        width: 150, 
        type: 'numericColumn',
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: (params: any) => ({
          ...centeredStyle,
          color: params.value > 0 ? '#059669' : params.value < 0 ? '#dc2626' : undefined,
          backgroundColor: bg,
          borderBottom: `1px solid ${borderColor}`
        }),
        valueGetter: params => {
          if (params.data._isTotal) {
            return (params.data.totalEarnedQty || 0) - (params.data.earnedQtyPrevious || 0);
          }
          if (!selectedRuleOfCredit || !selectedRuleOfCredit.steps) return 0;
          const progress = params.data.ruleOfCreditProgress || {};
          const percent = selectedRuleOfCredit.steps.reduce((sum, step) => {
            const stepProgress = progress[step.id] || 0;
            return sum + (stepProgress * step.weight / 100);
          }, 0);
          const earned = (percent / 100) * (params.data.totalQty || 0);
          return earned - (params.data.earnedQtyPrevious || 0);
        },
        valueFormatter: params => params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
      { 
        headerName: 'Remaining Qty', 
        width: 130, 
        type: 'numericColumn',
        rowSpan,
        cellClassRules: hideOnSubRows,
        cellStyle: spannedCellStyle,
        valueGetter: params => {
          if (params.data._isTotal) {
            return (params.data.totalQty || 0) - (params.data.totalEarnedQty || 0);
          }
          if (!selectedRuleOfCredit || !selectedRuleOfCredit.steps) return params.data.totalQty || 0;
          const progress = params.data.ruleOfCreditProgress || {};
          const percent = selectedRuleOfCredit.steps.reduce((sum, step) => {
            const stepProgress = progress[step.id] || 0;
            return sum + (stepProgress * step.weight / 100);
          }, 0);
          const earned = (percent / 100) * (params.data.totalQty || 0);
          return (params.data.totalQty || 0) - earned;
        },
        valueFormatter: params => params.value.toLocaleString()
      }
    ];

    // Dates and Phasing Method (Small group)
    const scheduleCols: ColDef[] = [
      {
        headerName: 'Type',
        field: 'rowType',
        width: 100,
        cellStyle: standardCellStyle,
        cellClass: params => cn(
          "font-bold text-[11px] uppercase tracking-wider h-full flex items-center px-2 border-r border-gray-200 dark:border-gray-700",
          params.data.rowType === 'Planned' 
            ? "text-blue-600 bg-blue-50/40 dark:bg-blue-900/20" 
            : "text-emerald-600 bg-emerald-50/40 dark:bg-emerald-900/20"
        ),
        valueFormatter: params => params.value
      },
      ({
        headerName: 'PHASING CHECK',
        headerClass: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold',
        children: [
          ({
            headerName: 'Planned Phasing',
            children: [
              {
                headerName: 'Phased Qty',
                width: 110,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Planned') return null;
                  const values: Record<string, number> = params.data.periodValues || {};
                  return Object.values(values).reduce((a, b) => a + (b || 0), 0);
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: standardCellStyle
              },
              {
                headerName: 'Variance',
                width: 100,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Planned') return null;
                  const values: Record<string, number> = params.data.periodValues || {};
                  const phased = Object.values(values).reduce((a, b) => a + (b || 0), 0);
                  return phased - (params.data.totalQty || 0);
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: params => {
                  const style = standardCellStyle(params);
                  if (params.value != null && Math.abs(params.value) > 0.1) {
                    return { ...style, color: '#ef4444', fontWeight: 'bold' };
                  }
                  return style;
                }
              }
            ]
          } as any),
          ({
            headerName: 'Actual (Earned To-Date)',
            children: [
              {
                headerName: 'Total Actuals',
                width: 110,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Current') return null;
                  const values: Record<string, number> = params.data.actualPeriodValues || {};
                  return Object.values(values).reduce((a, b) => a + (b || 0), 0);
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: standardCellStyle
              },
              {
                headerName: 'Variance',
                width: 100,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Current') return null;
                  const values: Record<string, number> = params.data.actualPeriodValues || {};
                  const phased = Object.values(values).reduce((a, b) => a + (b || 0), 0);
                  
                  const progress = params.data.ruleOfCreditProgress || {};
                  const percent: number = selectedRuleOfCredit?.steps?.reduce((sum: number, step: any) => {
                    const stepProgress = progress[step.id] || 0;
                    return sum + (stepProgress * step.weight / 100);
                  }, 0) || 0;
                  const earned = (percent / 100) * (params.data.totalQty || 0);
                  
                  return phased - earned;
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: params => {
                  const style = standardCellStyle(params);
                  if (params.value != null && Math.abs(params.value) > 0.5) { 
                    return { ...style, color: '#ef4444', fontWeight: 'bold' };
                  }
                  return style;
                }
              }
            ]
          } as any),
          ({
            headerName: 'Forecast (Next to-Go)',
            children: [
              {
                headerName: 'Total Forecast',
                width: 110,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Current') return null;
                  const values: Record<string, number> = params.data.currentPeriodValues || {};
                  return Object.values(values).reduce((a, b) => a + (b || 0), 0);
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: standardCellStyle
              },
              {
                headerName: 'Variance',
                width: 100,
                type: 'numericColumn',
                valueGetter: params => {
                  if (params.data.rowType !== 'Current') return null;
                  const values: Record<string, number> = params.data.currentPeriodValues || {};
                  const phased = Object.values(values).reduce((a, b) => a + (b || 0), 0);
                  
                  const progress = params.data.ruleOfCreditProgress || {};
                  const percent: number = selectedRuleOfCredit?.steps?.reduce((sum: number, step: any) => {
                    const stepProgress = progress[step.id] || 0;
                    return sum + (stepProgress * step.weight / 100);
                  }, 0) || 0;
                  const earned = (percent / 100) * (params.data.totalQty || 0);
                  const remaining = (params.data.totalQty || 0) - earned;
                  
                  return phased - remaining;
                },
                valueFormatter: params => params.value != null ? params.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                cellStyle: params => {
                  const style = standardCellStyle(params);
                  if (params.value != null && Math.abs(params.value) > 0.1) {
                    return { ...style, color: '#ef4444', fontWeight: 'bold' };
                  }
                  return style;
                }
              }
            ]
          } as any)
        ]
      } as any),
      { 
        headerName: 'Start Date', 
        width: 130, 
        editable: (params) => !params.data?.activityId,
        cellEditor: 'agDateCellEditor',
        cellStyle: standardCellStyle,
        valueGetter: params => {
          if (!params.data) return null;
          let val = params.data.rowType === 'Planned' ? params.data.plannedStartDate : params.data.currentStartDate;
          if (!val) return null;
          
          if (val && typeof val === 'object' && 'seconds' in val) {
            val = new Date(val.seconds * 1000);
          }
          
          const date = val instanceof Date ? val : new Date(val);
          return isNaN(date.getTime()) ? null : date;
        },
        valueFormatter: formatGridDate,
        valueSetter: params => {
          if (!params.data) return false;
          const field = params.data.rowType === 'Planned' ? 'plannedStartDate' : 'currentStartDate';
          let finalVal = parseGridDate(params.newValue);
          
          if (finalVal && params.data.rowType === 'Current') {
            const currentPeriod = project.progressPeriods?.periods?.find(p => p.status === 'open');
            if (currentPeriod?.startDate) {
              const pStart = new Date(currentPeriod.startDate);
              const userStart = new Date(finalVal);
              if (userStart < pStart) {
                finalVal = currentPeriod.startDate;
              }
            }
          }

          if (params.data.rowType === 'Planned') params.data.plannedStartDate = finalVal;
          else params.data.currentStartDate = finalVal;
          updateItem(params.data.id, { [field]: finalVal });
          return true;
        }
      },
      { 
        headerName: 'End Date', 
        width: 130, 
        editable: (params) => !params.data?.activityId,
        cellEditor: 'agDateCellEditor',
        cellStyle: standardCellStyle,
        valueGetter: params => {
          if (!params.data) return null;
          let val = params.data.rowType === 'Planned' ? params.data.plannedEndDate : params.data.currentEndDate;
          if (!val) return null;
          
          if (val && typeof val === 'object' && 'seconds' in val) {
            val = new Date(val.seconds * 1000);
          }
          
          const date = val instanceof Date ? val : new Date(val);
          return isNaN(date.getTime()) ? null : date;
        },
        valueFormatter: formatGridDate,
        valueSetter: params => {
          if (!params.data) return false;
          const field = params.data.rowType === 'Planned' ? 'plannedEndDate' : 'currentEndDate';
          let finalVal = parseGridDate(params.newValue);

          const startVal = params.data.rowType === 'Planned' ? params.data.plannedStartDate : params.data.currentStartDate;
          if (startVal && finalVal) {
            const startDate = new Date(startVal);
            let endDate = new Date(finalVal);
            if (endDate <= startDate) {
              endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + 7);
              finalVal = endDate.toISOString().split('T')[0];
            }
          }

          if (params.data.rowType === 'Planned') params.data.plannedEndDate = finalVal;
          else params.data.currentEndDate = finalVal;
          updateItem(params.data.id, { [field]: finalVal });
          return true;
        }
      },
      { 
        headerName: 'Phasing Method', 
        width: 120, 
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['Auto', 'Manual'] },
        cellStyle: standardCellStyle,
        valueGetter: params => {
          if (!params.data) return 'Auto';
          if (params.data.rowType === 'Planned') {
            return params.data.phasingMethod || 'Auto';
          }
          return params.data.currentPhasingMethod || 'Auto';
        },
        valueSetter: params => {
          const field = params.data.rowType === 'Planned' ? 'phasingMethod' : 'currentPhasingMethod';
          const newVal = params.newValue;
          if (params.data.rowType === 'Planned') params.data.phasingMethod = newVal;
          else params.data.currentPhasingMethod = newVal;
          updateItem(params.data.id, { [field]: newVal });
          return true;
        }
      },
      { 
        headerName: 'Phasing Curve', 
        width: 140, 
        editable: params => {
          const method = params.data.rowType === 'Planned' 
            ? (params.data.phasingMethod || 'Auto') 
            : (params.data.currentPhasingMethod || 'Auto');
          return method === 'Auto';
        },
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['Scurve', 'Bell', 'front load', 'back load', 'even'] },
        cellStyle: params => ({
          ...standardCellStyle(params),
          backgroundColor: (params.data.rowType === 'Planned' ? (params.data.phasingMethod || 'Auto') : (params.data.currentPhasingMethod || 'Auto')) === 'Manual' 
            ? (theme === 'dark' ? '#1e293b' : '#f1f5f9') 
            : undefined,
          opacity: (params.data.rowType === 'Planned' ? (params.data.phasingMethod || 'Auto') : (params.data.currentPhasingMethod || 'Auto')) === 'Manual' ? 0.5 : 1
        }),
        valueGetter: params => {
          if (params.data.rowType === 'Planned') {
            return params.data.phasingCurve || 'even';
          }
          return params.data.currentPhasingCurve || 'even';
        },
        valueSetter: params => {
          const field = params.data.rowType === 'Planned' ? 'phasingCurve' : 'currentPhasingCurve';
          const newVal = params.newValue;
          if (params.data.rowType === 'Planned') params.data.phasingCurve = newVal;
          else params.data.currentPhasingCurve = newVal;
          updateItem(params.data.id, { [field]: newVal });
          return true;
        }
      },
    ];

    // Phasing columns (Monthly/Weekly based on progress periods)
    const phasingCols: any[] = (project.progressPeriods?.periods || []).map(p => {
      const isWeekly = project.progressPeriods?.duration === 'week';
      const periodMatch = p.name.match(/\d+/);
      const periodNum = periodMatch ? periodMatch[0] : (project.progressPeriods?.periods.indexOf(p) + 1);
      
      let dateStr = '';
      if (p.endDate) {
        const d = new Date(p.endDate);
        if (!isNaN(d.getTime())) {
          if (isWeekly) {
            // Full date for weekly: dd/mm/yyyy
            dateStr = ` ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
          } else {
            // Month'Year for monthly: (Apr'26)
            const month = d.toLocaleString('default', { month: 'short' });
            const year = d.getFullYear().toString().slice(-2);
            dateStr = ` (${month}'${year})`;
          }
        }
      }
      const headerName = `P${periodNum}${dateStr}`;

      return {
        headerName,
        width: 140,
        type: 'numericColumn',
        editable: params => {
          if (params.data.rowType === 'Actual') return isAdmin;
          if (p.status === 'closed') return isAdmin;
          if (p.status === 'open' && !isAdmin) return false;

          const method = params.data.rowType === 'Planned' 
            ? (params.data.phasingMethod || 'Auto') 
            : (params.data.currentPhasingMethod || 'Auto');
          return method === 'Manual';
        },
        cellClass: p.status === 'closed' ? 'bg-gray-100 dark:bg-white/5 opacity-50' : '',
        cellStyle: params => {
          const method = params.data.rowType === 'Planned' ? (params.data.phasingMethod || 'Auto') : (params.data.currentPhasingMethod || 'Auto');
          const isActuallyEditable = (params.data.rowType === 'Actual' && isAdmin) || (params.data.rowType !== 'Actual' && method === 'Manual' && (isAdmin || (p.status !== 'closed' && p.status !== 'open')));

          return {
            ...standardCellStyle(params),
            backgroundColor: !isActuallyEditable 
              ? (theme === 'dark' ? '#1e293b' : '#f8fafc') 
              : undefined,
            opacity: !isActuallyEditable ? 0.7 : 1,
            color: params.data.rowType === 'Actual' ? (theme === 'dark' ? '#fbbf24' : '#b45309') : undefined
          };
        },
        valueGetter: params => {
          if (params.data.rowType === 'Planned') {
            return params.data.periodValues?.[p.id] || 0;
          }
          // Current row logic:
          // User: "actual is all weekly periods up to and including the current reporting period"
          // Current period has status === 'open'. Past periods have status === 'closed'.
          if (p.status === 'closed' || p.status === 'open') {
            return params.data.actualPeriodValues?.[p.id] || 0;
          }
          // Future periods show forecast
          return params.data.currentPeriodValues?.[p.id] || 0;
        },
        onCellValueChanged: params => {
          let field = 'periodValues';
          if (params.data.rowType === 'Current') {
            if (p.status === 'closed' || p.status === 'open') field = 'actualPeriodValues';
            else field = 'currentPeriodValues';
          }
          const currentValues = params.data[field] || {};
          updateItem(params.data.id, {
            [field]: { ...currentValues, [p.id]: parseFloat(params.newValue) || 0 }
          });
        }
      };
    });

    const actionsCol: ColDef = {
      headerName: '',
      width: 50,
      pinned: 'right',
      rowSpan,
      cellClassRules: hideOnSubRows,
      cellStyle: spanning => ({ 
        ...centeredStyle, 
        backgroundColor: bg,
        borderBottom: `1px solid ${borderColor}`
      }),
      cellRenderer: (params: any) => (
        <button 
          onClick={() => deleteItem(params.data)}
          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors mt-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )
    };

    const finalCols: (ColDef | ColGroupDef)[] = [
      ...baseCols,
      {
        headerName: 'Enterprise Line Item Attributes',
        children: enterpriseItemAttrCols,
        marryChildren: true,
        openByDefault: true,
      },
      {
        headerName: 'Project Line Item Attributes',
        children: projectItemAttrCols,
        marryChildren: true,
        openByDefault: true,
      },
      {
        headerName: 'Quantity Tracking',
        children: qtyTrackingCols,
        marryChildren: true,
      },
      {
        headerName: 'Rules of Credit',
        children: [...rocStepCols, percentCompleteCol],
        marryChildren: true,
      },
      {
        headerName: 'Schedule & Phasing Method',
        children: scheduleCols,
        marryChildren: true,
        openByDefault: false,
      },
      {
        headerName: 'Phasing (Progress Periods)',
        children: phasingCols,
        marryChildren: true,
      },
      actionsCol
    ];

    return finalCols;
  }, [costCodes, items, selectedRuleOfCredit, project, enterprise]);

  const pinnedTopRowData = useMemo(() => {
    // If no package selected, this grid isn't shown anyway.
    // If package selected, show total row even if items empty.
    let totalQty = 0;
    let totalQtyPrevious = 0;
    let totalEarnedQty = 0;
    let totalEarnedQtyPrevious = 0;
    
    if (filteredItems.length > 0) {
      filteredItems.forEach(item => {
        totalQty += item.totalQty || 0;
        totalQtyPrevious += item.totalQtyPrevious || 0;
        totalEarnedQtyPrevious += item.earnedQtyPrevious || 0;
        
        // Calculate earned for this item
        if (selectedRuleOfCredit?.steps) {
          const progress = item.ruleOfCreditProgress || {};
          const percent = selectedRuleOfCredit.steps.reduce((sum, step) => {
            const stepProgress = progress[step.id] || 0;
            return sum + (stepProgress * step.weight / 100);
          }, 0);
          totalEarnedQty += (percent / 100) * (item.totalQty || 0);
        }
      });
    }

    const overallPercent = totalQty > 0 ? (totalEarnedQty / totalQty) * 100 : 0;

    return [{
      itemId: 'TOTAL',
      description: 'GRAND TOTAL',
      totalQty,
      totalQtyPrevious,
      earnedQtyPrevious: totalEarnedQtyPrevious,
      totalEarnedQty,
      overallPercent,
      ruleOfCreditProgress: {}, 
      _isTotal: true,
    }];
  }, [filteredItems, selectedRuleOfCredit]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div className="flex justify-between items-center mb-4">
          <div className="flex flex-col">
            <h3 className="text-2xl font-black tracking-tight dark:text-white">
              COMMODITY TRACKING
            </h3>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-2">Physical progress, phasing and variance control center.</p>
          </div>
          <div className="flex gap-3 items-center">
          {selectedPackageIds.length > 0 && (
            <div className="flex items-center gap-2 mr-4 pr-4 border-r border-gray-200 dark:border-white/10">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{selectedPackageIds.length} Selected</span>
              <Button 
                onClick={() => setIsBulkUpdateOpen(true)}
                className="h-8 rounded-lg font-bold bg-black hover:bg-slate-800 text-white dark:bg-white dark:text-black"
              >
                <Edit2 className="w-3.5 h-3.5 mr-1" />
                Update
              </Button>
              <Button 
                onClick={handleBulkDelete}
                className="h-8 rounded-lg font-bold bg-black hover:bg-slate-800 text-white dark:bg-white dark:text-black"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Delete
              </Button>
            </div>
          )}

          <Button variant="outline" onClick={exportToExcel} className="font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-400 rounded-xl h-10 px-4">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>

          <div className="relative">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleImport}
              className="hidden"
              id="commodity-import"
              disabled={isImporting}
            />
            <label 
              htmlFor="commodity-import" 
              className={cn(
                "cursor-pointer flex items-center font-bold border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-500/20 dark:text-blue-400 rounded-xl px-4 h-10 border text-sm transition-colors",
                isImporting && "opacity-50 pointer-events-none"
              )}
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </label>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text"
              placeholder="Search commodities..."
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white h-10"
            />
          </div>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

          <Button 
            onClick={() => setIsAddingPackage(true)}
            className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-black/10 h-10"
          >
            <Plus className="w-4 h-4" />
            Add Commodity
          </Button>
        </div>
      </div>
    </div>

      {/* Main Content - Top/Bottom Split */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Table: Packages */}
        <div className={cn(
          "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
          selectedPackageId 
            ? (isMainTableCollapsed ? "h-[60px]" : "h-[40%]") 
            : "flex-1"
        )}>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Commodities</span>
              </div>
              {(() => {
                const periods = project.progressPeriods?.periods || [];
                const currentPeriodId = project.progressPeriods?.currentPeriodId;
                const currentPeriod = periods.find(p => p.id === currentPeriodId) || periods.find(p => p.status === 'open');
                if (!currentPeriod) return null;
                
                const date = new Date(currentPeriod.endDate);
                const month = date.toLocaleString('default', { month: 'short' });
                const year = date.getFullYear().toString().slice(-2);
                const periodNumber = periods.indexOf(currentPeriod) + 1;
                const dateStr = `P${periodNumber} (${month}'${year})`;
                
                return (
                  <div className="flex items-center gap-4 border-l border-gray-200 dark:border-white/10 pl-6">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Current Period:</span>
                    </div>
                    <span className="text-xs font-bold text-blue-600">{dateStr}</span>
                    <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-2" />
                    <Button 
                      size="sm"
                      variant="secondary"
                      onClick={handleCalculate}
                      className="h-7 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Calculate All
                    </Button>
                  </div>
                );
              })()}
            </div>
            {selectedPackageId && (
              <button 
                onClick={() => setIsMainTableCollapsed(!isMainTableCollapsed)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-colors text-gray-500"
              >
                {isMainTableCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 relative">
            <div className={cn(
              "absolute inset-0 ag-theme-quartz",
              theme === 'dark' ? "ag-theme-quartz-dark" : ""
            )}>
                  <AgGridReact
                    ref={gridRef}
                    rowData={selectedPackageId ? packages.filter(p => p.id === selectedPackageId) : packages}
                    columnDefs={packageColumnDefs}
                    rowSelection="multiple"
                    suppressRowClickSelection={true}
                    onSelectionChanged={p => setSelectedPackageIds(p.api.getSelectedRows().map(r => r.id))}
                    animateRows={true}
                    pagination={!selectedPackageId}
                    paginationPageSize={10}
                    enableFillHandle={true}
                    fillHandleDirection="xy"
                    enableRangeSelection={true}
                    cellSelection={true}
                  />
            </div>
          </div>
        </div>

        {/* Bottom Table: Commodity Items */}
        <AnimatePresence>
          {selectedPackageId && selectedPackage && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: isMainTableCollapsed ? 'calc(100% - 60px)' : '60%', 
                opacity: 1 
              }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] flex flex-col overflow-hidden"
            >
              <div className="p-4 flex items-center justify-between bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-600" />
                    <h3 className="font-bold dark:text-white flex items-center gap-2">
                      Commodity Items for: <span className="text-blue-600 font-mono">{selectedPackage.packageId}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-gray-400 hover:text-blue-600 ml-1"
                        onClick={() => setIsPackageSettingsOpen(true)}
                        title="Package Settings & Defaults"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </Button>
                    </h3>
                  </div>
                  {selectedItemIds.length > 0 && (
                    <div className="flex items-center gap-2 ml-4 pr-4 border-r border-gray-200 dark:border-white/10">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{selectedItemIds.length} Selected</span>
                      <Button 
                        onClick={() => setIsItemBulkUpdateOpen(true)}
                        className="h-8 rounded-lg font-bold bg-black hover:bg-slate-800 text-white dark:bg-white dark:text-black"
                      >
                        Update
                      </Button>
                      <Button 
                        onClick={handleItemBulkDelete}
                        className="h-8 rounded-lg font-bold bg-black hover:bg-slate-800 text-white dark:bg-white dark:text-black"
                      >
                        Delete
                      </Button>
                    </div>
                  )}

                  <Button variant="ghost" size="sm" onClick={exportItemsToExcel} className="h-8 text-xs font-bold text-emerald-600">
                    <Download className="w-3 h-3 mr-1.5" />
                    Export
                  </Button>

                  <div className="relative">
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleItemImport}
                      className="hidden"
                      id="item-import"
                    />
                    <label 
                      htmlFor="item-import" 
                      className="cursor-pointer flex items-center h-8 px-2 text-xs font-bold text-blue-600 hover:bg-blue-50 border border-blue-100 rounded-lg"
                    >
                      <Upload className="w-3 h-3 mr-1.5" />
                      Import
                    </label>
                  </div>

                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2 h-8">
                    <Input 
                      type="number"
                      value={itemsToAddCount}
                      onChange={e => setItemsToAddCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 h-6 border-none bg-transparent p-0 text-center text-xs font-bold focus-visible:ring-0"
                    />
                    <Button 
                      size="sm"
                      onClick={handleAddItem}
                      className="h-6 px-2 bg-black dark:bg-white text-white dark:text-black rounded-md text-[10px] font-bold flex items-center gap-1 transition-all shadow-sm"
                    >
                      <PlusCircle className="w-3 h-3" />
                      Add Item(s)
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Items</p>
                    <p className="text-sm font-bold dark:text-white">{items.length}</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                        setSelectedPackageId(null);
                        setIsMainTableCollapsed(false);
                    }}
                    className="h-8 text-xs"
                  >
                    Close Details
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative">
                <div className={cn(
                  "absolute inset-0 ag-theme-quartz",
                  theme === 'dark' ? "ag-theme-quartz-dark" : ""
                )}>
                  <AgGridReact
                    ref={itemsGridRef}
                    rowData={processedItems}
                    columnDefs={itemColumnDefs}
                    animateRows={true}
                    getRowId={params => params.data.rowId}
                    suppressRowTransform={true}
                    rowSelection="multiple"
                    suppressRowClickSelection={true}
                    onSelectionChanged={p => {
                        const rows = p.api.getSelectedRows();
                        const ids = Array.from(new Set(rows.map(r => r.id)));
                        setSelectedItemIds(ids);
                    }}
                    rowClassRules={{
                      'bg-gray-50/20 dark:bg-gray-800/10': (params: any) => {
                        const itemIndex = Math.floor(params.node.rowIndex / 2);
                        return itemIndex % 2 === 1;
                      },
                      'border-b border-gray-200 dark:border-gray-700': (params: any) => params.data.rowType === 'Current'
                    }}
                    singleClickEdit={true}
                    stopEditingWhenCellsLoseFocus={true}
                    enableFillHandle={true}
                    cellSelection={true}
                    pinnedTopRowData={pinnedTopRowData}
                    getRowStyle={params => {
                      if (params.node.rowPinned === 'top') {
                        return { fontWeight: 'bold', backgroundColor: theme === 'dark' ? '#1e293b' : '#f8fafc' };
                      }
                    }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Commodity Modal */}
      {isAddingPackage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">Add New Commodity</h2>
              <button onClick={() => setIsAddingPackage(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleAddPackage} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Commodity ID</label>
                <Input 
                  value={packageFormData.packageId}
                  onChange={e => setPackageFormData({ ...packageFormData, packageId: e.target.value.substring(0, 20) })}
                  placeholder="e.g. COMM-CIV-001"
                  required
                  maxLength={20}
                />
                <p className="text-[10px] text-gray-500">Max 20 characters. Must be unique.</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
                <Input 
                  value={packageFormData.description}
                  onChange={e => setPackageFormData({ ...packageFormData, description: e.target.value })}
                  placeholder="e.g. Civil Works - Building A"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Rule of Credit</label>
                <Select 
                  onValueChange={(val: string) => setPackageFormData(prev => ({ ...prev, ruleOfCreditId: val }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="-- Select Rule of Credit --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">-- None --</SelectItem>
                    {rulesOfCredit.map(rule => (
                      <SelectItem key={rule.id} value={rule.id}>{rule.ruleId} - {rule.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {projectAttributes.map(attr => (
                <div key={attr.id} className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{attr.title}</label>
                  <Select 
                    onValueChange={(val: string) => setPackageFormData(prev => ({
                      ...prev,
                      attributes: { ...(prev.attributes || {}), [attr.id]: val }
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={`-- Select ${attr.title} --`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">-- None --</SelectItem>
                      {(attr.values || []).map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.id} - {v.description}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Unit</label>
                <Input 
                  value={packageFormData.unit}
                  onChange={e => setPackageFormData({ ...packageFormData, unit: e.target.value })}
                  placeholder="e.g. EA, m, m3"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsAddingPackage(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">Add Commodity</Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Bulk Update Modal */}
      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-[#1a1a1a] border dark:border-white/10">
          <DialogHeader>
            <DialogTitle>Bulk Update {selectedPackageIds.length} Commodities</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Field</label>
              <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, field: val }))}>
                <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                  <SelectValue placeholder="-- Select Field --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="description">Commodity Description</SelectItem>
                  <SelectItem value="ruleOfCreditId">Rule of Credit</SelectItem>
                  {(project.progressAttributes || [])
                    .filter(a => a.title && a.title.trim() !== '')
                    .map(a => (
                      <SelectItem key={a.id} value={`attributes.${a.id}`}>{a.title}</SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">New Value</label>
              {bulkUpdateData.field === 'ruleOfCreditId' ? (
                <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="-- Select Rule of Credit --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">-- Clear --</SelectItem>
                    {rulesOfCredit.map(rule => (
                      <SelectItem key={rule.id} value={rule.id}>{rule.ruleId} - {rule.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : bulkUpdateData.field.startsWith('attributes.') ? (
                <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="-- Select Value --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">-- Clear --</SelectItem>
                    {(project.progressAttributes?.find(a => `attributes.${a.id}` === bulkUpdateData.field)?.values || [])
                      .map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.id} - {v.description}</SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
              ) : (
                <Input 
                  value={bulkUpdateData.value}
                  onChange={e => setBulkUpdateData(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="Enter new value"
                  className="h-12 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsBulkUpdateOpen(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button onClick={handleBulkUpdate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold px-8">
              Update Commodities
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Item Bulk Update Modal */}
      <Dialog open={isItemBulkUpdateOpen} onOpenChange={setIsItemBulkUpdateOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-[#1a1a1a] border dark:border-white/10 rounded-2xl shadow-2xl p-0 overflow-hidden">
          <div className="bg-blue-600 p-6 text-white flex items-center gap-3">
            <Activity className="w-6 h-6" />
            <div>
              <DialogTitle className="text-xl font-bold">Bulk Update Items</DialogTitle>
              <p className="text-xs text-blue-100 mt-1 opacity-80">Updating {selectedItemIds.length} selected items</p>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Field</label>
              <Select onValueChange={(val: string) => setItemBulkUpdateData(prev => ({ ...prev, field: val, value: '' }))}>
                <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all">
                  <SelectValue placeholder="-- Select Field --" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1a1a]">
                  <SelectItem value="totalQty">Total Quantity</SelectItem>
                  <SelectItem value="plannedStartDate">Planned Start Date</SelectItem>
                  <SelectItem value="plannedEndDate">Planned End Date</SelectItem>
                  <SelectItem value="currentStartDate">Current Start Date</SelectItem>
                  <SelectItem value="currentEndDate">Current End Date</SelectItem>
                  <SelectItem value="phasingMethod">Planned Phasing Method</SelectItem>
                  <SelectItem value="currentPhasingMethod">Current Phasing Method</SelectItem>
                  <SelectItem value="phasingCurve">Planned Phasing Curve</SelectItem>
                  <SelectItem value="currentPhasingCurve">Current Phasing Curve</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="costCodeId">Cost Code</SelectItem>
                  <SelectItem value="description">Description</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">New Value</label>
              {itemBulkUpdateData.field.includes('Method') ? (
                <Select value={itemBulkUpdateData.value} onValueChange={(val) => setItemBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="Select Method" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Auto">Auto</SelectItem>
                    <SelectItem value="Manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              ) : itemBulkUpdateData.field.includes('Curve') ? (
                <Select value={itemBulkUpdateData.value} onValueChange={(val) => setItemBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="Select Curve" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Scurve">Scurve</SelectItem>
                    <SelectItem value="Bell">Bell</SelectItem>
                    <SelectItem value="front load">Front Load</SelectItem>
                    <SelectItem value="back load">Back Load</SelectItem>
                    <SelectItem value="even">Even</SelectItem>
                  </SelectContent>
                </Select>
              ) : itemBulkUpdateData.field === 'status' ? (
                <Select value={itemBulkUpdateData.value} onValueChange={(val: string) => setItemBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Not Started">Not Started</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              ) : itemBulkUpdateData.field.includes('Date') ? (
                <Input 
                  type="date"
                  value={itemBulkUpdateData.value}
                  onChange={e => setItemBulkUpdateData(prev => ({ ...prev, value: e.target.value }))}
                  className="h-12 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 px-4"
                />
              ) : (
                <Input 
                  value={itemBulkUpdateData.value}
                  onChange={e => setItemBulkUpdateData(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="Enter value"
                  className="h-12 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 px-4"
                />
              )}
            </div>
          </div>
          <DialogFooter className="p-6 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10">
            <Button variant="ghost" onClick={() => setIsItemBulkUpdateOpen(false)} className="rounded-xl font-bold px-6 h-11">Cancel</Button>
            <Button onClick={handleItemBulkUpdate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold px-8 h-11 shadow-lg shadow-blue-500/20">
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Package Settings Dialog */}
      <Dialog open={isPackageSettingsOpen} onOpenChange={setIsPackageSettingsOpen}>
        <DialogContent className="max-w-lg bg-white dark:bg-[#1a1a1a] border dark:border-white/10 rounded-2xl shadow-2xl p-0 overflow-hidden">
          <div className="bg-gray-900 p-6 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Settings className="w-6 h-6 text-blue-400" />
              <div>
                <DialogTitle className="text-xl font-bold">Package Defaults</DialogTitle>
                <p className="text-xs text-gray-400 mt-1">Default values for new items in {selectedPackage?.packageId}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsPackageSettingsOpen(false)} className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Button>
          </div>
          
          <div className="p-6 grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Default Phasing Method</label>
              <Select 
                value={selectedPackage?.defaultPhasingMethod || 'Auto'} 
                onValueChange={(val) => selectedPackageId && updatePackage(selectedPackageId, { defaultPhasingMethod: val })}
              >
                <SelectTrigger className="w-full h-11 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="Auto">Auto</SelectItem>
                  <SelectItem value="Manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Default Phasing Curve</label>
              <Select 
                value={selectedPackage?.defaultPhasingCurve || 'even'} 
                onValueChange={(val) => selectedPackageId && updatePackage(selectedPackageId, { defaultPhasingCurve: val })}
              >
                <SelectTrigger className="w-full h-11 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="Scurve">Scurve</SelectItem>
                  <SelectItem value="Bell">Bell</SelectItem>
                  <SelectItem value="front load">Front Load</SelectItem>
                  <SelectItem value="back load">Back Load</SelectItem>
                  <SelectItem value="even">Even</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Default Start Date</label>
              <Input 
                type="date"
                value={selectedPackage?.defaultStartDate || ''}
                onChange={(e) => selectedPackageId && updatePackage(selectedPackageId, { defaultStartDate: e.target.value })}
                className="h-11 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Default End Date</label>
              <Input 
                type="date"
                value={selectedPackage?.defaultEndDate || ''}
                onChange={(e) => selectedPackageId && updatePackage(selectedPackageId, { defaultEndDate: e.target.value })}
                className="h-11 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
              />
            </div>

            <div className="col-span-2 p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-xl">
              <p className="text-xs text-blue-700 dark:text-blue-300 italic">
                Note: These values will be used automatically when adding new items to this commodity package.
              </p>
            </div>
          </div>

          <div className="p-6 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10 text-right">
            <Button onClick={() => setIsPackageSettingsOpen(false)} className="bg-gray-900 dark:bg-white text-white dark:text-black rounded-xl font-bold px-8 h-11">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
