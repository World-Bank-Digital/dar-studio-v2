# Render Blueprint relink after a GitHub repository transfer

## Conclusion

Render does not document or publicly expose a way to change an existing
Blueprint's repository or branch. The public Blueprint update endpoint can
change only `name`, `autoSync`, and the Blueprint file `path`. Its disconnect
operation is an HTTP `DELETE`: it removes the Blueprint relationship while
explicitly retaining all services and other managed resources. The documented
recovery shape is therefore to disconnect the old Blueprint and create a new
Blueprint instance that associates the existing services; do not assume that
the old Blueprint ID can be recovered.

The service identities can be preserved. Render's official Blueprint
documentation supports applying a Blueprint to an existing service by matching
its name. The official creation-flow screenshot also shows an **Associate
existing services** choice and explains why it is disabled while those
services still belong to another Blueprint. It is reasonable to infer that,
after the old Blueprint is disconnected, the new Blueprint flow can associate
the now-unmanaged matching services. Treat this as a guarded dashboard step:
if Render proposes newly suffixed services instead of association, abort rather
than deploy.

## What does and does not deploy

- Editing **Build > Source** in the Render dashboard always triggers a deploy
  from the new source.
- `PATCH /v1/services/{serviceId}` can update `repo`, `branch`, and `autoDeploy`
  without deploying. Render states that a separate deploy API call is required
  regardless of `autoDeploy`.
- A Blueprint sync automatically redeploys services whose configuration is
  affected. Disabling Blueprint Auto Sync prevents push-triggered syncs, but
  does not make a manually initiated/new-Blueprint sync non-deploying.
- `autoDeployTrigger: off` prevents commit-triggered service deploys. It does
  not guarantee that a Blueprint configuration application will avoid a
  deploy.

For that reason, treat the initial new-Blueprint association as potentially
deployment-triggering even when the repository's head commit is unchanged.
Render does not document a no-deploy flag for Blueprint creation or
association.

## Safest cutover procedure

1. Install or configure the Render GitHub App on the destination organization
   with access only to the transferred repository. Confirm the Render Git
   deployment credential used by each service has access to that repository.
2. Record a read-only baseline: old Blueprint ID/repository/branch/path/status,
   both service IDs and names, repository and branch, auto-deploy state,
   successful deploy IDs and commit SHAs, Docker settings, plans/regions,
   environment-variable and secret-file names, disk identity/mount/size, health
   check, custom domains, and deploy hooks. Do not print secret values.
3. Set the old Blueprint's **Auto Sync** to **No** and confirm both services have
   automatic deploys disabled. This closes the race in which the old Blueprint
   could overwrite a manual service-source update.
4. Validate the destination repository's `render.yaml` against the target
   Render workspace and compare every declared field with the read-only
   baseline. The current file uses `sync: false` for secrets; Render preserves
   existing environment variables and ignores `sync: false` values during
   updates, but non-YAML configuration must still be verified explicitly.
5. Disconnect the old Blueprint. This preserves its services and resources but
   permanently removes the old Blueprint instance.
6. Update each retained service with the API, not the dashboard, setting the
   canonical destination `repo`, `branch: main`, and `autoDeploy: no`. This is
   the documented no-deploy source-update route.
7. Re-read both services. Require unchanged service IDs, deploy IDs/SHAs, disk
   attachment, environment-variable names, and runtime configuration, plus the
   new canonical repository and disabled auto-deploy state.
8. In Render, choose **New > Blueprint**, connect the transferred destination
   repository, choose `main`, and use the existing Blueprint file path.
9. On the review screen, explicitly choose **Associate existing services**.
   Require the two exact existing names and no create/suffix actions. If the
   option is disabled, or the plan proposes `-<suffix>` resources, abort and
   contact Render support; do not continue.
10. Review the complete plan for unintended configuration changes. In
    particular, verify plan, region, disk, health check, shutdown delay,
    Dockerfile/context, instance count, and all environment-variable names.
11. Before clicking **Deploy Blueprint**, decide whether a worker rebuild is
    acceptable. If it is not, stop at the reviewed plan and ask Render support
    for an in-place migration. If it is, follow the public-source cutover in the
    [deployment runbook](DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md): require zero
    active workflows, verify the exact DAR source, prove an anonymous shallow
    fetch of the exact public DAMM commit in an isolated Git environment, remove
    the legacy `damm_git_netrc` Secret File with Save only while the worker is
    suspended, repeat the source and zero-active checks immediately before
    resume, and require the settled build to contain no GitHub source
    credential.
12. Deploy the new Blueprint only in a controlled window. Confirm both original
    service IDs remain attached, set the new Blueprint's Auto Sync to **No**,
    verify service auto-deploy remains off, and compare health and deployment
    identity with the baseline.

## Lower-risk continuity option

If the immediate goal is merely to restore GitHub access while keeping
production untouched, install the Render GitHub App on the destination
organization, update the services' Git credentials, leave the old Blueprint
Auto Sync off, and do not sync or edit source in the dashboard. GitHub
redirects Git traffic from the old repository URL after a transfer, but GitHub
recommends updating integrations to the new canonical URL and warns that the
redirect disappears if the old repository path is reused. This is a temporary
continuity posture, not a completed institutional relink.

## Sources

- [Render: Connect your Git provider](https://render.com/docs/git-provider) —
  install/configure the GitHub App for the destination organization and update
  per-service Git credentials.
- [Render API: Update service](https://api-docs.render.com/reference/update-service)
  — accepts `repo`, `branch`, and `autoDeploy`; configuration changes do not
  deploy until the deploy API is called.
- [Render API: Update Blueprint](https://api-docs.render.com/reference/update-blueprint)
  — only `name`, `autoSync`, and `path` are mutable; repository and branch are
  not request fields.
- [Render API: Disconnect Blueprint](https://api-docs.render.com/reference/disconnect-blueprint)
  — disconnect is `DELETE`; services and other resources remain.
- [Render: Blueprints](https://render.com/docs/infrastructure-as-code) —
  association/replication behavior, resource preservation on disconnect,
  configuration application, and automatic-sync controls.
- [Render: Blueprint YAML reference](https://render.com/docs/blueprint-spec) —
  existing-resource matching, repository inheritance, auto-deploy settings,
  preserved existing environment variables, disks, and `sync: false` behavior.
- [Render changelog: Change a service's backing repository](https://render.com/changelog/change-your-services-backing-repo-or-image-in-the-render-dashboard)
  — dashboard source changes automatically trigger a deploy.
- [GitHub: Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
  — old Git URLs redirect, but GitHub recommends updating to the canonical new
  URL and warns that path reuse removes the redirect.
