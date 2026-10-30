-- Append a bounded legal-entity profile. Preserve existing profile/receipt bytes.
ALTER TABLE connector_policy_versions DROP CONSTRAINT connector_policy_versions_adapter_id_check;
ALTER TABLE connector_policy_versions ADD CONSTRAINT connector_policy_versions_adapter_id_check CHECK(adapter_id IN('companies_house_profile_v1','rdap_domain_v1','supplied_webpage_v1','gleif_lei_v1'));
ALTER TABLE connector_policy_scopes DROP CONSTRAINT connector_policy_scopes_adapter_id_check;
ALTER TABLE connector_policy_scopes ADD CONSTRAINT connector_policy_scopes_adapter_id_check CHECK(adapter_id IN('rdap_domain_v1','supplied_webpage_v1','gleif_lei_v1'));
ALTER TABLE connector_policy_scopes ADD CONSTRAINT gleif_fixed_endpoint CHECK(adapter_id<>'gleif_lei_v1' OR endpoint_scope='https://api.gleif.org/api/v1/lei-records/');
ALTER TABLE research_request_versions DROP CONSTRAINT research_request_versions_adapter_id_check;
ALTER TABLE research_request_versions ADD CONSTRAINT research_request_versions_adapter_id_check CHECK(adapter_id IN('rdap_domain_v1','supplied_webpage_v1','gleif_lei_v1'));
ALTER TABLE research_runs DROP CONSTRAINT research_runs_execution_mode_check;
ALTER TABLE research_runs ADD CONSTRAINT research_runs_execution_mode_check CHECK(execution_mode IN('supplied','rdap_transport','lei_transport'));
