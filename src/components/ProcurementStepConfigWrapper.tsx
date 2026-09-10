import React, { useState, useEffect } from 'react';
import { subscribeToTable } from '../lib/supabase';
import { fetchProjectSteps, fetchEnterpriseSteps } from '../lib/procurement';
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
    let active = true;

    // Both lists come from procurement_step_definitions; a row belongs to the
    // enterprise or to a project depending on which id it carries.
    const load = async () => {
      try {
        const [steps, entSteps] = await Promise.all([
          fetchProjectSteps(project.id),
          project.enterpriseId ? fetchEnterpriseSteps(project.enterpriseId) : Promise.resolve([]),
        ]);
        if (!active) return;
        setCurrentSteps(steps);
        setEnterpriseSteps(entSteps);
      } catch (error) {
        console.error('Procurement steps fetch error:', error);
      }
    };
    void load();

    const unsubscribe = subscribeToTable('procurement_step_definitions', undefined, () => void load());
    return () => { active = false; unsubscribe(); };
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
