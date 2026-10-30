# FollowTheMoney adaptation

Source: https://github.com/alephdata/followthemoney at `c70a89ffa59ea785956f6095643310da3735b7fb`. Actual MIT licence and Python manifest inspected before adaptation. Original copyright and permission notice retained in LICENSE.

INVEOS adapts eight property names/labels from Thing, LegalEntity and Company into its own bounded, versioned, source-linked entity attributes. No upstream entity resolver, automatic matching, datasets or executable Python package is incorporated. Ambiguous identities remain separate; every attribute binds a reviewed finding and exact authority/source hash. Attribution does not imply upstream endorsement.

The upstream manifest requires Python >=3.10 and Babel, PyYAML/types, SQLAlchemy/stubs, banal, rigour, click, requests, normality, countrynames, prefixdate, fingerprints, phonenumbers, pytz, rdflib, networkx, openpyxl and orjson. None is installed or added by this adaptation; existing TypeScript/React/PostgreSQL code executes it. No new runtime dependency or external service. The ignored pinned checkout is research evidence, not shipped application code.

Inspected file SHA-256:

- `LICENSE`: `ded7e69a4f51b53d5e87aedaf8d0d1c1c98e2f3ced6c2b6a9475ba3b553dd990`
- `pyproject.toml`: `e202284c7b5ea0f82e353dd860ad6c90e2cfaf3c48a5ab5675b09d6f283040f8`
- `followthemoney/schema/Thing.yaml`: `216569ca1506baf47ac797b239b3e3274784232607bb0d452d618b7ba69a35ab`
- `followthemoney/schema/LegalEntity.yaml`: `d40a2e3aef7b95b29e2cfd5535aa6b37fa0009d4ef729b461e86fe59b91cd7b4`
- `followthemoney/schema/Company.yaml`: `a335cffcf1e5cbf70e6b7c632a4c5a5279705dcfb48ec2d8b7febcd80baa978f`
