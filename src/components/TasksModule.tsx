import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { taskService } from '../services/taskService';
import { Loading, useLoad } from './common/loadUi';
import { ToastProvider } from './leave/ui';
import { taskNav, taskNavItems, type Section } from './tasks/taskNav';
import { TasksContext, type Meta, type Task } from './tasks/common';
import { MyTasks } from './tasks/MyTasks';
import { Board } from './tasks/Board';
import { Dashboard } from './tasks/Dashboard';
import { Projects } from './tasks/Projects';
import { TaskDrawer } from './tasks/TaskDrawer';
import { TaskForm } from './tasks/TaskForm';

/**
 * Task Management: my tasks, boards, dashboards and projects. Everyone can plan their own work;
 * managers give work to the people who report to them; admins see across the company.
 * Sections live in the app sidebar, like Payroll and Performance.
 */
export const TasksModule: React.FC<{ currentUser: User; users: User[] }> = () => {
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const { data, error, loading, reload } = useLoad(() => taskService.get<{ success: boolean } & Meta>('meta'), [version]);
  const meta = data as Meta | null;

  const badge = meta ? meta.counts.overdue + meta.counts.review : 0;
  const items = taskNavItems(badge);
  const itemsKey = items.map((i) => `${i.key}${i.badge || ''}`).join(',');
  useEffect(() => { taskNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => taskNav.publish([]), []);
  const { section: chosen } = taskNav.useNav();
  const section = taskNav.resolve(chosen, items) as Section;

  const [openId, setOpenId] = useState('');
  const [form, setForm] = useState<{ defaults?: Partial<Task> } | null>(null);
  useEffect(() => { setOpenId(''); setForm(null); }, [section]);

  const ctx = useMemo(() => (meta ? { meta, version, changed, openTask: setOpenId, newTask: (defaults?: Partial<Task>) => setForm({ defaults }) } : null), [meta, version, changed]);
  // Keep the screen on what it already shows while the numbers reload in the background.
  const [shown, setShown] = useState<typeof ctx>(null);
  useEffect(() => { if (ctx) setShown(ctx); }, [ctx]);

  const body = () => {
    switch (section) {
      case 'mine': return <MyTasks />;
      case 'board': return <Board />;
      case 'dashboard': return <Dashboard />;
      case 'projects': return <Projects />;
      default: return null;
    }
  };
  return (
    <ToastProvider>
      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-6xl w-full mx-auto">
        {!shown ? <Loading error={error} loading={loading} /> : (
          <TasksContext.Provider value={shown}>
            {body()}
            {openId && <TaskDrawer id={openId} onClose={() => setOpenId('')} />}
            {form && <TaskForm defaults={form.defaults} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); changed(); setOpenId(t.id); }} />}
          </TasksContext.Provider>
        )}
      </div>
    </ToastProvider>
  );
};
