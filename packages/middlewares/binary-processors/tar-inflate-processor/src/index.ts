/*
 * Copyright (C) 2023 Amazon.com, Inc. or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as node from 'aws-cdk-lib/aws-lambda-nodejs';

import { Construct } from 'constructs';
import { ServiceDescription } from '@project-lakechain/core/service';
import { ComputeType } from '@project-lakechain/core/compute-type';
import { when } from '@project-lakechain/core/dsl/vocabulary/conditions';
import { CacheStorage } from '@project-lakechain/core';

import {
  Middleware,
  MiddlewareBuilder,
  MiddlewareProps,
  LAMBDA_INSIGHTS_VERSION,
  NAMESPACE
} from '@project-lakechain/core/middleware';

/**
 * The service description.
 */
const description: ServiceDescription = {
  name: 'tar-inflate-processor',
  description: 'Inflates tarballs from a source to a destination bucket.',
  version: '0.1.0',
  attrs: {}
};

/**
 * The maximum time the lambda function
 * is allowed to run.
 */
const PROCESSING_TIMEOUT = cdk.Duration.minutes(15);

/**
 * The execution runtime for used compute.
 */
const EXECUTION_RUNTIME  = lambda.Runtime.NODEJS_18_X;

/**
 * The default memory size to allocate for the compute.
 */
const DEFAULT_MEMORY_SIZE = 512;

/**
 * The builder for the `TarInflateProcessor` middleware.
 */
class TarInflateProcessorBuilder extends MiddlewareBuilder {

  /**
   * @returns a new instance of the `TarInflateProcessor`
   * service constructed with the given parameters.
   */
  public build(): TarInflateProcessor {
    return (new TarInflateProcessor(
      this.scope,
      this.identifier, {
        ...this.props
      }
    ));
  }
}

/**
 * A middleware providing a way to inflate TAR
 * files from a source bucket into a destination
 * bucket.
 */
export class TarInflateProcessor extends Middleware {

  /**
   * The storage containing processed files.
   */
  public storage: CacheStorage

  /**
   * The data processor lambda function.
   */
  public processor: lambda.IFunction;

  /**
   * The builder for the `TarInflateProcessor` service.
   */
  static Builder = TarInflateProcessorBuilder;

  /**
   * Construct constructor.
   */
  constructor(scope: Construct, id: string, props: MiddlewareProps) {
    super(scope, id, description, {
      ...props,
      queueVisibilityTimeout: cdk.Duration.seconds(
        6 * PROCESSING_TIMEOUT.toSeconds()
      )
    });

    ///////////////////////////////////////////
    ////////    Processing Storage      ///////
    ///////////////////////////////////////////

    this.storage = new CacheStorage(this, 'Storage', {
      encryptionKey: props.kmsKey
    });

    ///////////////////////////////////////////
    //////    Middleware Event Handler     ////
    ///////////////////////////////////////////

    this.processor = new node.NodejsFunction(this, 'Processor', {
      description: 'Inflates tarballs from a source to a destination bucket.',
      entry: path.resolve(__dirname, 'lambdas', 'inflater', 'index.js'),
      vpc: props.vpc,
      memorySize: props.maxMemorySize ?? DEFAULT_MEMORY_SIZE,
      timeout: PROCESSING_TIMEOUT,
      runtime: EXECUTION_RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      environmentEncryption: props.kmsKey,
      logGroup: this.logGroup,
      insightsVersion: props.cloudWatchInsights ?
        LAMBDA_INSIGHTS_VERSION :
        undefined,
      environment: {
        POWERTOOLS_SERVICE_NAME: description.name,
        POWERTOOLS_METRICS_NAMESPACE: NAMESPACE,
        PROCESSED_FILES_BUCKET: this.storage.id(),
        SNS_TARGET_TOPIC: this.eventBus.topicArn
      },
      bundling: {
        minify: true,
        externalModules: [
          '@aws-sdk/client-s3',
          '@aws-sdk/client-sns',
          '@aws-sdk/lib-storage'
        ]
      }
    });

    // Allows this construct to act as a `IGrantable`
    // for other middlewares to grant the processing
    // lambda permissions to access their resources.
    this.grantPrincipal = this.processor.grantPrincipal;

    // Plug the SQS queue into the lambda function.
    this.processor.addEventSource(new sources.SqsEventSource(this.eventQueue, {
      batchSize: props.batchSize ?? 1,
      reportBatchItemFailures: true
    }));

    // Grant the lambda function permissions to
    // write to the post-processing storage.
    this.storage.grantWrite(this.processor);

    // Grant the lambda function permissions to
    // publish to the SNS topic.
    this.eventBus.grantPublish(this.processor);

    super.bind();
  }

  /**
   * Allows a grantee to read from the processed documents
   * generated by this middleware.
   */
  public grantReadProcessedDocuments(grantee: iam.IGrantable): iam.Grant {
    return (this.storage.grantRead(grantee));
  }

  /**
   * @returns an array of mime-types supported as input
   * type by this middleware.
   */
  supportedInputTypes(): string[] {
    return ([
      'application/x-tar',
      'application/x-gzip'
    ]);
  }

  /**
   * @returns an array of mime-types supported as output
   * type by the data producer.
   */
  supportedOutputTypes(): string[] {
    return ([
      '*/*'
    ]);
  }

  /**
   * @returns the supported compute types by a given
   * middleware.
   */
  supportedComputeTypes(): ComputeType[] {
    return ([
      ComputeType.CPU
    ]);
  }

  /**
   * @returns the middleware conditional statement defining
   * in which conditions this middleware should be executed.
   * In this case, we want the middleware to only be invoked
   * when the document mime-type is supported, and the event
   * type is `document-created`.
   */
  conditional() {
    return (super
      .conditional()
      .and(when('type').equals('document-created'))
    );
  }
}
