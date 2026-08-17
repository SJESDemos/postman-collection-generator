// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Toggle from '@cloudscape-design/components/toggle';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { api } from './api';
import {
  CATEGORY_SOURCE,
  SERVICE_CATEGORIES,
  UNCLASSIFIED_CATEGORY,
  categorizeService,
  type ServiceCategory,
} from './categories';
import type {
  CatalogResponse,
  CategorizedService,
  CollectionStatus,
  Job,
  JobKind,
} from './types';

type ScopeFilter = 'all' | 'tracked' | 'untracked' | 'unmapped';

const scopeOptions: SelectProps.Option[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Tracked', value: 'tracked' },
  { label: 'Untracked', value: 'untracked' },
  { label: 'Needs collection', value: 'unmapped' },
];

function initialCategory(): string {
  return new URLSearchParams(window.location.search).get('category') || 'all';
}

function formatAge(value: string): string {
  if (!value) return 'Never';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function collectionStatus(status: CollectionStatus) {
  if (status === 'mapped') return <StatusIndicator type="success">Mapped</StatusIndicator>;
  if (status === 'missing') return <StatusIndicator type="error">Deleted</StatusIndicator>;
  return <StatusIndicator type="warning">Unmapped</StatusIndicator>;
}

function trackingStatus(tracked: boolean) {
  return tracked
    ? <StatusIndicator type="success">Tracked</StatusIndicator>
    : <StatusIndicator type="stopped">Untracked</StatusIndicator>;
}

interface CategoryNavigationProps {
  categories: ServiceCategory[];
  services: CategorizedService[];
  activeCategoryId: string;
  selectedIds: Set<string>;
  onCategoryChange: (categoryId: string) => void;
  onSelectionChange: (serviceId: string, selected: boolean) => void;
}

function CategoryNavigation({
  categories,
  services,
  activeCategoryId,
  selectedIds,
  onCategoryChange,
  onSelectionChange,
}: CategoryNavigationProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeCategoryId === 'all' ? [] : [activeCategoryId]),
  );

  useEffect(() => {
    if (activeCategoryId !== 'all') {
      setExpanded((current) => new Set(current).add(activeCategoryId));
    }
  }, [activeCategoryId]);

  const servicesByCategory = useMemo(() => {
    const result = new Map<string, CategorizedService[]>();
    for (const category of categories) {
      result.set(
        category.id,
        services
          .filter((service) => service.categoryIds.includes(category.id))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
    }
    return result;
  }, [categories, services]);

  function toggleCategory(categoryId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  return (
    <nav className="category-navigation" aria-label="AWS service categories">
      <div className="category-navigation__heading">
        <Box variant="h2">Service categories</Box>
        <Link external href={CATEGORY_SOURCE}>AWS source</Link>
      </div>
      <button
        type="button"
        className={`category-navigation__all ${activeCategoryId === 'all' ? 'is-active' : ''}`}
        onClick={() => onCategoryChange('all')}
      >
        <span>All Services</span>
        <Badge color="grey">{services.length}</Badge>
      </button>
      <div className="category-navigation__list">
        {categories.map((category) => {
          const categoryServices = servicesByCategory.get(category.id) ?? [];
          const isExpanded = expanded.has(category.id);
          const isActive = activeCategoryId === category.id;
          const trackedCount = categoryServices.filter((service) => service.tracked).length;
          const unmappedCount = categoryServices.filter((service) => service.tracked && service.collection_status !== 'mapped').length;
          return (
            <div className="category-navigation__group" key={category.id}>
              <div className={`category-navigation__row ${isActive ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className={`category-navigation__toggle ${isExpanded ? 'is-expanded' : ''}`}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${category.label}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleCategory(category.id)}
                />
                <button
                  type="button"
                  className="category-navigation__category"
                  onClick={() => {
                    onCategoryChange(category.id);
                    setExpanded((current) => new Set(current).add(category.id));
                  }}
                >
                  <span>{category.label}</span>
                  <span className="category-navigation__counts">
                    {categoryServices.length}
                    {trackedCount > 0 && <span title={`${trackedCount} tracked`}> / {trackedCount}</span>}
                    {unmappedCount > 0 && <span className="category-navigation__attention" title={`${unmappedCount} need creation`}> / {unmappedCount}</span>}
                  </span>
                </button>
              </div>
              {isExpanded && (
                <div className="category-navigation__services">
                  {categoryServices.map((service) => (
                    <Checkbox
                      key={service.id}
                      checked={selectedIds.has(service.id)}
                      onChange={({ detail }) => onSelectionChange(service.id, detail.checked)}
                    >
                      <span title={service.id}>{service.name}</span>
                    </Checkbox>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategory);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filteringText, setFilteringText] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [protocol, setProtocol] = useState('all');
  const [createMissing, setCreateMissing] = useState(true);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [publishModalVisible, setPublishModalVisible] = useState(false);
  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const showError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setFlashItems([{
      type: 'error',
      header: 'Action failed',
      content: message,
      dismissible: true,
      onDismiss: () => setFlashItems([]),
      id: 'action-error',
    }]);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const nextCatalog = await api.catalog();
      setCatalog(nextCatalog);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadCatalog();
    void api.jobs()
      .then((jobs) => {
        const active = jobs.active_job_id
          ? jobs.jobs.find((job) => job.id === jobs.active_job_id)
          : jobs.jobs[0];
        if (active) setCurrentJob(active);
      })
      .catch(showError);
  }, [loadCatalog, showError]);

  useEffect(() => {
    if (!currentJob || currentJob.status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      void api.job(currentJob.id)
        .then((job) => {
          setCurrentJob(job);
          if (job.status !== 'running') void loadCatalog();
        })
        .catch(showError);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentJob, loadCatalog, showError]);

  const services = useMemo(
    () => (catalog?.services ?? []).map(categorizeService).sort((left, right) => left.name.localeCompare(right.name)),
    [catalog],
  );

  const unclassifiedCount = services.filter((service) => service.primaryCategoryId === 'unclassified').length;
  const categories = useMemo(
    () => unclassifiedCount > 0 ? [...SERVICE_CATEGORIES, UNCLASSIFIED_CATEGORY] : SERVICE_CATEGORIES,
    [unclassifiedCount],
  );

  const categoryLabel = activeCategoryId === 'all'
    ? 'All Services'
    : categories.find((category) => category.id === activeCategoryId)?.label ?? 'All Services';

  const protocolOptions = useMemo<SelectProps.Option[]>(() => [
    { label: 'All protocols', value: 'all' },
    ...[...new Set(services.map((service) => service.protocol))]
      .sort()
      .map((value) => ({ label: value, value })),
  ], [services]);

  const visibleServices = useMemo(() => {
    const query = filteringText.trim().toLowerCase();
    return services.filter((service) => {
      const categoryMatches = activeCategoryId === 'all' || service.categoryIds.includes(activeCategoryId);
      const queryMatches = !query || `${service.name} ${service.id}`.toLowerCase().includes(query);
      const scopeMatches = scope === 'all'
        || (scope === 'tracked' && service.tracked)
        || (scope === 'untracked' && !service.tracked)
        || (scope === 'unmapped' && service.collection_status !== 'mapped');
      const protocolMatches = protocol === 'all' || service.protocol === protocol;
      return categoryMatches && queryMatches && scopeMatches && protocolMatches;
    });
  }, [activeCategoryId, filteringText, protocol, scope, services]);

  const selectedServices = useMemo(
    () => services.filter((service) => selectedIds.has(service.id)),
    [selectedIds, services],
  );

  const selectedVisibleServices = useMemo(
    () => visibleServices.filter((service) => selectedIds.has(service.id)),
    [selectedIds, visibleServices],
  );

  const jobRunning = currentJob?.status === 'running';
  const trackedCount = services.filter((service) => service.tracked).length;
  const mappedCount = services.filter((service) => service.collection_status === 'mapped').length;
  const needsCreationCount = services.filter((service) => service.tracked && service.collection_status !== 'mapped').length;

  function changeCategory(categoryId: string) {
    setActiveCategoryId(categoryId);
    const url = new URL(window.location.href);
    if (categoryId === 'all') url.searchParams.delete('category');
    else url.searchParams.set('category', categoryId);
    window.history.replaceState({}, '', url);
  }

  function changeSelection(serviceId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(serviceId);
      else next.delete(serviceId);
      return next;
    });
  }

  async function updateTracking(track: boolean) {
    if (selectedIds.size === 0) return;
    const nextTracked = new Set(services.filter((service) => service.tracked).map((service) => service.id));
    selectedIds.forEach((serviceId) => track ? nextTracked.add(serviceId) : nextTracked.delete(serviceId));
    if (nextTracked.size === 0) {
      showError(new Error('At least one service must remain tracked.'));
      return;
    }
    try {
      setCatalog(await api.updateTracking([...nextTracked]));
    } catch (error) {
      showError(error);
    }
  }

  async function startJob(kind: JobKind) {
    if (kind !== 'check' && selectedServices.length === 0) {
      showError(new Error('Select at least one service first.'));
      return;
    }
    const untracked = selectedServices.filter((service) => !service.tracked);
    if (kind !== 'check' && untracked.length > 0) {
      showError(new Error(`Track selected services before running the pipeline: ${untracked.map((service) => service.id).join(', ')}`));
      return;
    }
    try {
      const job = await api.startJob(kind, selectedServices.map((service) => service.id), createMissing);
      setCurrentJob(job);
      setPublishModalVisible(false);
    } catch (error) {
      showError(error);
    }
  }

  const columnDefinitions: TableProps.ColumnDefinition<CategorizedService>[] = [
    {
      id: 'service',
      header: 'Service',
      cell: (service) => (
        <div className="service-cell">
          <Box fontWeight="bold">{service.name}</Box>
          <Box color="text-body-secondary" fontSize="body-s">{service.id}</Box>
        </div>
      ),
      sortingField: 'name',
      minWidth: 230,
    },
    {
      id: 'category',
      header: 'Primary category',
      cell: (service) => categories.find((category) => category.id === service.primaryCategoryId)?.label ?? 'Unclassified',
      minWidth: 210,
    },
    {
      id: 'protocol',
      header: 'Protocol',
      cell: (service) => (
        <div>
          <code>{service.protocol}</code>
          <Box color="text-body-secondary" fontSize="body-s">{service.version || 'No model version'}</Box>
        </div>
      ),
      minWidth: 140,
    },
    {
      id: 'operations',
      header: 'Operations',
      cell: (service) => service.operations,
      sortingField: 'operations',
      width: 110,
    },
    {
      id: 'tracking',
      header: 'Tracking',
      cell: (service) => trackingStatus(service.tracked),
      minWidth: 120,
    },
    {
      id: 'collection',
      header: 'Postman collection',
      cell: (service) => collectionStatus(service.collection_status),
      minWidth: 155,
    },
    {
      id: 'last-published',
      header: 'Last published',
      cell: (service) => formatAge(service.last_pushed),
      minWidth: 130,
    },
  ];

  if (window.location.protocol === 'file:') {
    return (
      <main className="direct-open">
        <Header variant="h1">AWS API Collections</Header>
        <Container header={<Header variant="h2">Open the local server URL</Header>}>
          <SpaceBetween size="s">
            <Box>This application cannot run directly from a file path.</Box>
            <Box>Run <code>./webui.py</code>, then open the localhost URL printed by the command.</Box>
          </SpaceBetween>
        </Container>
      </main>
    );
  }

  return (
    <>
      <TopNavigation
        identity={{ href: '/', title: 'AWS API Collections' }}
        utilities={[{
          type: 'button',
          text: catalog?.workspace_configured ? catalog.workspace_name : 'Workspace not configured',
          disableUtilityCollapse: true,
        }]}
      />
      <AppLayout
        contentType="table"
        navigationWidth={330}
        minContentWidth={760}
        toolsHide
        navigation={(
          <CategoryNavigation
            categories={categories}
            services={services}
            activeCategoryId={activeCategoryId}
            selectedIds={selectedIds}
            onCategoryChange={changeCategory}
            onSelectionChange={changeSelection}
          />
        )}
        breadcrumbs={(
          <BreadcrumbGroup
            items={activeCategoryId === 'all'
              ? [{ text: 'All Services', href: './' }]
              : [{ text: 'All Services', href: './' }, { text: categoryLabel, href: `?category=${activeCategoryId}` }]}
            onFollow={(event) => {
              if (event.detail.href === './') {
                event.preventDefault();
                changeCategory('all');
              }
            }}
          />
        )}
        notifications={<Flashbar items={flashItems} />}
        content={(
          <ContentLayout
            header={(
              <Header
                variant="h1"
                description="Track AWS services and create or refresh their Postman collections."
                actions={(
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button iconName="status-pending" disabled={jobRunning} onClick={() => void startJob('check')}>Check source</Button>
                    <Button iconName="refresh" loading={loading} onClick={() => void loadCatalog()}>Reload</Button>
                  </SpaceBetween>
                )}
              >
                {categoryLabel}
              </Header>
            )}
          >
            <SpaceBetween size="l">
              <Container>
                <ColumnLayout columns={4} variant="text-grid">
                  <div><Box variant="awsui-key-label">Available services</Box><Box variant="awsui-value-large">{services.length}</Box></div>
                  <div><Box variant="awsui-key-label">Tracked</Box><Box variant="awsui-value-large">{trackedCount}</Box></div>
                  <div><Box variant="awsui-key-label">Mapped collections</Box><Box variant="awsui-value-large">{mappedCount}</Box></div>
                  <div><Box variant="awsui-key-label">Need creation</Box><Box variant="awsui-value-large">{needsCreationCount}</Box></div>
                </ColumnLayout>
              </Container>

              <Table
                variant="full-page"
                stickyHeader
                stripedRows
                resizableColumns
                loading={loading}
                loadingText="Loading AWS services"
                selectionType="multi"
                trackBy="id"
                selectedItems={selectedVisibleServices}
                onSelectionChange={({ detail }) => {
                  const visibleIds = new Set(visibleServices.map((service) => service.id));
                  const nextVisibleIds = new Set(detail.selectedItems.map((service) => service.id));
                  setSelectedIds((current) => {
                    const next = new Set([...current].filter((serviceId) => !visibleIds.has(serviceId)));
                    nextVisibleIds.forEach((serviceId) => next.add(serviceId));
                    return next;
                  });
                }}
                columnDefinitions={columnDefinitions}
                items={visibleServices}
                empty={(
                  <Box textAlign="center" color="inherit">
                    <b>No services</b>
                    <Box variant="p" color="inherit">No services match the current category and filters.</Box>
                  </Box>
                )}
                filter={(
                  <div className="service-filters">
                    <TextFilter
                      filteringText={filteringText}
                      filteringPlaceholder={`Search ${categoryLabel.toLowerCase()}`}
                      filteringAriaLabel="Search services"
                      onChange={({ detail }) => setFilteringText(detail.filteringText)}
                    />
                    <Select
                      selectedOption={scopeOptions.find((option) => option.value === scope) ?? null}
                      options={scopeOptions}
                      onChange={({ detail }) => setScope((detail.selectedOption.value ?? 'all') as ScopeFilter)}
                    />
                    <Select
                      selectedOption={protocolOptions.find((option) => option.value === protocol) ?? null}
                      options={protocolOptions}
                      onChange={({ detail }) => setProtocol(detail.selectedOption.value ?? 'all')}
                    />
                  </div>
                )}
                header={(
                  <Header
                    counter={`(${visibleServices.length})`}
                    description={`${selectedIds.size} selected across all categories`}
                    actions={(
                      <SpaceBetween direction="horizontal" size="xs">
                        <Button disabled={selectedIds.size === 0 || jobRunning} onClick={() => void updateTracking(true)}>Track</Button>
                        <Button disabled={selectedIds.size === 0 || jobRunning} onClick={() => void updateTracking(false)}>Untrack</Button>
                        <Button disabled={selectedIds.size === 0 || jobRunning} onClick={() => setSelectedIds(new Set())}>Clear</Button>
                        <Button iconName="view-full" disabled={selectedIds.size === 0 || jobRunning} onClick={() => void startJob('preview')}>Preview</Button>
                        <Button variant="primary" iconName="upload" disabled={selectedIds.size === 0 || jobRunning} onClick={() => setPublishModalVisible(true)}>Publish</Button>
                      </SpaceBetween>
                    )}
                  >
                    Services
                  </Header>
                )}
              />

              {currentJob && (
                <Container
                  header={(
                    <Header
                      variant="h2"
                      description={`${currentJob.services.length || 'All tracked'} service${currentJob.services.length === 1 ? '' : 's'}; started ${new Date(currentJob.started_at).toLocaleTimeString()}`}
                      actions={(
                        <StatusIndicator type={currentJob.status === 'running' ? 'in-progress' : currentJob.status === 'succeeded' ? 'success' : 'error'}>
                          {currentJob.status === 'running' ? 'Running' : currentJob.status === 'succeeded' ? 'Succeeded' : 'Failed'}
                        </StatusIndicator>
                      )}
                    >
                      {currentJob.kind === 'check' ? 'Checking source changes' : currentJob.kind === 'preview' ? 'Previewing selected services' : 'Publishing selected collections'}
                    </Header>
                  )}
                >
                  <pre className="job-output">{currentJob.output || 'Waiting for pipeline output...'}</pre>
                </Container>
              )}
            </SpaceBetween>
          </ContentLayout>
        )}
      />

      <Modal
        visible={publishModalVisible}
        onDismiss={() => setPublishModalVisible(false)}
        header="Publish selected collections?"
        footer={(
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPublishModalVisible(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void startJob('publish')}>Publish</Button>
            </SpaceBetween>
          </Box>
        )}
      >
        <SpaceBetween size="m">
          <Box>
            This fetches the configured model source, synchronizes the local branch and any optional mirror, converts {selectedServices.length} selected service{selectedServices.length === 1 ? '' : 's'}, and writes changed collections to the configured Postman workspace.
          </Box>
          <Toggle checked={createMissing} onChange={({ detail }) => setCreateMissing(detail.checked)}>
            Create missing collections
          </Toggle>
        </SpaceBetween>
      </Modal>
    </>
  );
}

export default App;
