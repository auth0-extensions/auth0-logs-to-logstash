# Auth0 - Logs to Logstash

This extension will take all of your Auth0 logs and export them to Logstash.

## Installation

The extension can be installed from within the [Extensions Gallery](https://manage.auth0.com/#/extensions).

## Local Development

To run the extension locally (in development mode) you can run the following commands:

```bash
yarn install
npm run serve:dev
```

## Configuring Logstash

Very simple, but there is some ground work getting setup, in particular if installing locally.

Assuming here you wish to make use of the `ELK` stack - visualizing data with ElasticSearch, Logstash, and Kibana.

Here are some instructions on getting setup:

```
brew install elasticsearch
brew install logstash
brew install kibana
```

Strongly recommend you install the latest versions of each.
Install the [plugins](https://www.elastic.co/guide/en/logstash/current/input-plugins.html) you need.

For this NPM module, you need to have [logstash-input-http](https://github.com/logstash-plugins/logstash-input-http) installed.
By default, this is already installed on modern versions of `logstash` out of the box.

In separate terminal windows (shells), just run:

```
$ elasticsearch
$ kibana
```

If you opted to have elasticsearch and kibana start automatically as a service on startup, then you don't need to explicitly start them as above.

#### Get some data into Logstash

For test purposes only, just run the following:

```
curl -H "content-type: application/json" -XPUT 'http://127.0.0.1:8080/twitter/tweet/1' -d '{ "user" : "arcseldon", "post_date" : "2016-04-23T14:12:12", "message" : "Testing Auth0 integration with Elasticsearch" }'
```

You could do a `POST` request here, and change the URI to be different to `twitter/tweet/` etc.

Change the `user` value as you wish, and also update the `post_date` value to something near realtime. Just be careful here, I would recommned setting it to something like 12 hours earlier than the current time (to get around any timezone issues etc - remember we're doing a barebones test here, so you can sort this out later - we just want to see this work for now).

You should be getting an `ok` response. Run the same command about 10 times just so we have a few entries to play with.


#### Now set up a default index:

Open Kibana - `http://localhost:5601/` - Settings.

Leave `index contains time-based events` ticked.
Just enter `user` for the index name or pattern
For `Time-field name` (which becomes visible after you enter an accepted index name), choose `post_date` and hit `Create`

Now head over to `Discover` from the top nav bar, and enter `*` for the search, and hit enter. You should see your data.

Right, you're setup locally, time to use the Auth0 extension!

## Issue Reporting

If you have found a bug or if you have a feature request, please report them at this repository issues section. Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/whitehat) details the procedure for disclosing security issues.

## Author

[Auth0](auth0.com)

## What is Auth0?

Auth0 helps you to:

* Add authentication with [multiple authentication sources](https://docs.auth0.com/identityproviders), either social like **Google, Facebook, Microsoft Account, LinkedIn, GitHub, Twitter, Box, Salesforce, amont others**, or enterprise identity systems like **Windows Azure AD, Google Apps, Active Directory, ADFS or any SAML Identity Provider**.
* Add authentication through more traditional **[username/password databases](https://docs.auth0.com/mysql-connection-tutorial)**.
* Add support for **[linking different user accounts](https://docs.auth0.com/link-accounts)** with the same user.
* Support for generating signed [Json Web Tokens](https://docs.auth0.com/jwt) to call your APIs and **flow the user identity** securely.
* Analytics of how, when and where users are logging in.
* Pull data from other sources and add it to the user profile, through [JavaScript rules](https://docs.auth0.com/rules).

## Create a free Auth0 Account

1. Go to [Auth0](https://auth0.com) and click Sign Up.
2. Use Google, GitHub or Microsoft Account to login.

## License

This project is licensed under the MIT license. See the [LICENSE](LICENSE) file for more info.
