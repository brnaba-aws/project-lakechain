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

import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';

import { Construct } from 'constructs';
import { ServiceDescription } from '@project-lakechain/core/service';
import { ComputeType } from '@project-lakechain/core/compute-type';

import {
  Middleware,
  MiddlewareBuilder
} from '@project-lakechain/core/middleware';
import {
  FirehoseStorageConnectorProps,
  FirehoseStorageConnectorPropsSchema
} from './definitions/opts';

/**
 * The service description.
 */
const description: ServiceDescription = {
  name: 'firehose-storage-connector',
  description: 'Forwards document metadata to a Firehose delivery stream.',
  version: '0.1.0',
  attrs: {}
};

/**
 * Builder for the `FirehoseStorageConnector` service.
 */
class FirehoseStorageConnectorBuilder extends MiddlewareBuilder {
  private providerProps: Partial<FirehoseStorageConnectorProps> = {};

  /**
   * Sets the destination Firehose delivery stream to forward
   * processing results to.
   * @param destinationStream the destination Firehose delivery stream.
   * @returns the builder instance.
   */
  public withDestinationStream(destinationStream: firehose.CfnDeliveryStream) {
    this.providerProps.destinationStream = destinationStream;
    return (this);
  }

  /**
   * @returns a new instance of the `FirehoseStorageConnector`
   * service constructed with the given parameters.
   */
  public build(): FirehoseStorageConnector {
    return (new FirehoseStorageConnector(
      this.scope,
      this.identifier, {
        ...this.providerProps as FirehoseStorageConnectorProps,
        ...this.props
      }
    ));
  }
}

/**
 * Forwards document events to an a Firehose delivery stream
 * using the native integration between SNS and Firehose.
 */
export class FirehoseStorageConnector extends Middleware {

  /**
   * The builder for the `FirehoseStorageConnector` service.
   */
  static Builder = FirehoseStorageConnectorBuilder;

  /**
   * Construct constructor.
   */
  constructor(scope: Construct, id: string, private props: FirehoseStorageConnectorProps) {
    super(scope, id, description, props);

    // Validate the properties.
    this.props = this.parse(FirehoseStorageConnectorPropsSchema, props);

    super.bind();
  }

  /**
   * We override the `getInput` method to return the user-provided
   * delivery stream. This way this middleware only acts as a passthrough between
   * the previous middleware's SNS topics and the user-provided delivery stream.
   * @returns the user-provided delivery stream.
   */
  public getInput() {
    return (this.props.destinationStream);
  }

  /**
   * Allows a grantee to read from the processed documents
   * generated by this middleware.
   */
  grantReadProcessedDocuments(_: iam.IGrantable): iam.Grant {
    return ({} as iam.Grant);
  }

  /**
   * @returns an array of mime-types supported as input
   * type by this middleware.
   */
  supportedInputTypes(): string[] {
    return ([
      '*/*'
    ]);
  }

  /**
   * @returns an array of mime-types supported as output
   * type by the data producer.
   */
  supportedOutputTypes(): string[] {
    return ([]);
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
}
