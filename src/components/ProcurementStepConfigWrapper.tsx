import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { Project, Enterprise, ProcurementStepDefinition } from '../types';
import ProcurementStepConfig from './ProcurementStepConfig';

interface ProcurementStepConfigWrapperProps {
  project: Project;
  enterprise: Enterprise;
}

export default function ProcurementStepConfigWrapper({ project, enterprise }: ProcurementStepConfigWrapperProps) {
  const [currentSteps, setCurrentSteps] = useState<ProcurementStepDefinition[]>([]);
  const [enterpriseSteps, setEnterpriseSteps] = useState<ProcurementStepDefinition[]>([]);

  useEffect(() => {
    if (!project.id) return;
    
    // Fetch Project Steps
    const stepsQuery = query(
      collection(db, 'procurementStepDefinitions'), 
      where('projectId', '==', project.id),
      orderBy('order', 'asc')
    );
    const unsubSteps = onSnapshot(stepsQuery, (snapshot) => {
      setCurrentSteps(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProcurementStepDefinition)));
    });

    // Fetch Enterprise Steps
    const entStepsQuery = query(
      collection(db, 'procurementStepDefinitions'), 
      where('enterpriseId', '==', project.enterpriseId),
      orderBy('order', 'asc')
    );
    const unsubEntSteps = onSnapshot(entStepsQuery, (snapshot) => {
      setEnterpriseSteps(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProcurementStepDefinition)));
    });

    return () => {
      unsubSteps();
      unsubEntSteps();
    };
  }, [project.id, project.enterpriseId]);

  return (
    <ProcurementStepConfig 
      project={project} 
      enterprise={enterprise} 
      currentSteps={currentSteps} 
      enterpriseSteps={enterpriseSteps} 
    />
  );
}
