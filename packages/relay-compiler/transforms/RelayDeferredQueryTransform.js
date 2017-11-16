/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @providesModule RelayDeferredQueryTransform
 * @format
 */

'use strict';

const {
  assertAbstractType,
  assertCompositeType,
  assertLeafType,
  GraphQLNonNull
} = require('graphql');
const {
  CompilerContext,
  SchemaUtils,
  IRTransformer,
} = require('graphql-compiler');
const invariant = require('invariant');

import type {FragmentSpread, InlineFragment, LinkedField, ScalarField} from 'graphql-compiler';

import {GraphQLCompositeType} from 'graphql';
const {
  canHaveSelections,
  getRawType,
  hasID,
  implementsInterface,
  isAbstractType,
  mayImplement,
} = SchemaUtils;

const ID = 'id';
const ID_TYPE = 'ID';
const NODE_TYPE = 'Node';


/**
 *
 */
function relayDeferredQueryTransform(
  context: CompilerContext,
): CompilerContext {
  const idType = assertLeafType(context.schema.getType(ID_TYPE));
  const nodeType = assertAbstractType(context.schema.getType(NODE_TYPE));
  const queryType = assertCompositeType(context.schema.getQueryType());
  let newQueries = [];
  let idCounter = 0;

  function generateID() {
    return idCounter++;
  }

  function visitRoot(root, state) {
    // state.queryName = root.name;
    const id = generateID();
    state = {
      queryName: root.name,
      splitQueries: [],
      parentID: id,
    };
    const result = this.traverse(root, state);
    newQueries = state.splitQueries.map((x => x.root));
    console.log(state.splitQueries)
    return result;
  }

  function visitFragmentSpread(fragmentSpread: FragmentSpread, state) {
    if (!state.queryName) {
      return null;
    }
    const fragment = context.getFragment(fragmentSpread.name);
    const directiveIndex = fragmentSpread.directives.findIndex(isDeferred);
    if (directiveIndex !== -1) {
      assertImplementsNode(fragment.type);
      const inlineFragment = {
        kind: 'InlineFragment',
        metadata: null,
        directives: [],
        typeCondition: fragment.type,
        selections: []
      };
      const id = generateID();
      const queryName = `${state.queryName}Deferred${id}`;
      const deferredQuery = buildDeferredQuery(queryName, inlineFragment);
      const newState = {
        queryName: state.queryName,
        splitQueries: state.splitQueries,
        parentID: id
      };
      state.splitQueries.push({ id, required: state.parentID, root: deferredQuery });
      const newFragment = this.traverse(fragment, newState);
      inlineFragment.selections = newFragment.selections;
      return null;
    }

    return fragmentSpread;
  }

  function isDeferred(directive) {
    return directive.name === 'defer';
  }

  function assertImplementsNode(type) {
    invariant(
      implementsInterface(type, NODE_TYPE),
      'RelayDeferredQueryTransform: Defer can only be used on types implementing Node interface'
    );
  }

  function buildDeferredQuery(name, fragmentSpread) {
    return {
      argumentDefinitions: [{
        kind: 'RootArgumentDefinition',
        metadata: null,
        name: 'id',
        type: new GraphQLNonNull(idType),
      }],
      directives: [],
      kind: 'Root',
      metadata: null,
      name,
      operation: 'query',
      selections: [
        buildLinkedField(
          'node',
          nodeType,
          [['id', {kind: 'Variable', metadata: null, variableName: 'id'}, idType]],
          [fragmentSpread]
        )
      ],
      type: queryType,
    };
  }

  function buildLinkedField(name, type, args, selections) {
    return {
      kind: 'LinkedField',
      alias: null,
      args: args.map(arg => buildArgument(...arg)),
      directives: [],
      handles: null,
      metadata: null,
      name,
      selections,
      type,
    };
  }

  function buildArgument(name, value, type) {
    return {
      kind: 'Argument',
      metadata: null,
      name,
      type: type,
      value,
    };
  }
  return IRTransformer.transform(
    context,
    {
      FragmentSpread: visitFragmentSpread,
      Root: visitRoot
    },
    () => ({ num: 1 }),
  ).addAll(newQueries);
}


/**
 * @internal
 *
 * Returns IR for `... on FRAGMENT_TYPE { id }`
 */
function buildIDFragment(
  fragmentType: GraphQLCompositeType,
  idField: ScalarField,
): InlineFragment {
  return {
    kind: 'InlineFragment',
    directives: [],
    metadata: null,
    typeCondition: fragmentType,
    selections: [idField],
  };
}

module.exports = {
  transform: relayDeferredQueryTransform,
};
