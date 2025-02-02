import { QueryPromise } from '~/query-promise';
import { Query, SQL, SQLWrapper } from '~/sql';
import { Table } from '~/table';

import { AnyPgColumn } from '~/pg-core/columns';
import { PgDialect } from '~/pg-core/dialect';
import { SelectFields } from '~/pg-core/operations';
import { PgSession, PreparedQuery, PreparedQueryConfig } from '~/pg-core/session';
import { AnyPgTable, GetTableConfig, InferModel } from '~/pg-core/table';
import { orderSelectedFields } from '~/pg-core/utils';

import {
	AnyPgSelect,
	JoinFn,
	JoinNullability,
	JoinType,
	PgSelectConfig,
	SelectMode,
	SelectResult,
} from './select.types';

export interface PgSelect<
	TTable extends AnyPgTable,
	TResult = InferModel<TTable>,
	TSelectMode extends SelectMode = 'single',
	TJoinsNotNullable extends Record<string, JoinNullability> = Record<GetTableConfig<TTable, 'name'>, 'not-null'>,
> extends QueryPromise<SelectResult<TResult, TSelectMode, TJoinsNotNullable>[]>, SQLWrapper {}

export class PgSelect<
	TTable extends AnyPgTable,
	// TResult is either a map of columns (partial select) or a map of inferred field types (full select)
	TResult = InferModel<TTable>,
	TSelectMode extends SelectMode = 'single',
	TJoinsNotNullable extends Record<string, JoinNullability> = Record<GetTableConfig<TTable, 'name'>, 'not-null'>,
> extends QueryPromise<SelectResult<TResult, TSelectMode, TJoinsNotNullable>[]> implements SQLWrapper {
	declare protected $table: TTable;
	declare protected $selectMode: TSelectMode;
	declare protected $result: TResult;

	private config: PgSelectConfig;
	private isPartialSelect = false;
	private joinsNotNullable: Record<string, boolean>;

	constructor(
		table: PgSelectConfig['table'],
		fields: PgSelectConfig['fields'],
		private session: PgSession,
		private dialect: PgDialect,
	) {
		super();
		this.config = {
			table,
			fields,
			joins: {},
			orderBy: [],
			groupBy: [],
		};
		this.joinsNotNullable = { [table[Table.Symbol.Name]]: true };
	}

	private createJoin<TJoinType extends JoinType>(
		joinType: TJoinType,
	): JoinFn<TTable, TSelectMode, TJoinType, TResult, TJoinsNotNullable> {
		return (table: AnyPgTable, on: SQL): AnyPgSelect => {
			const tableName = table[Table.Symbol.Name];

			if (!this.isPartialSelect) {
				// If this is the first join and this is not a partial select, "move" the fields from the main table to the nested object
				if (Object.keys(this.joinsNotNullable).length === 1) {
					this.config.fields = this.config.fields.map((field) => ({
						...field,
						path: [this.config.table[Table.Symbol.Name], ...field.path],
					}));
				}
				this.config.fields.push(...orderSelectedFields(table[Table.Symbol.Columns], [tableName]));
			}

			this.config.joins[tableName] = { on, table, joinType };

			switch (joinType) {
				case 'left':
					this.joinsNotNullable[tableName] = false;
					break;
				case 'right':
					this.joinsNotNullable = Object.fromEntries(
						Object.entries(this.joinsNotNullable).map(([key]) => [key, false]),
					);
					this.joinsNotNullable[tableName] = true;
					break;
				case 'inner':
					this.joinsNotNullable = Object.fromEntries(
						Object.entries(this.joinsNotNullable).map(([key]) => [key, true]),
					);
					this.joinsNotNullable[tableName] = true;
					break;
				case 'full':
					this.joinsNotNullable = Object.fromEntries(
						Object.entries(this.joinsNotNullable).map(([key]) => [key, false]),
					);
					this.joinsNotNullable[tableName] = false;
					break;
			}

			return this;
		};
	}

	leftJoin = this.createJoin('left');

	rightJoin = this.createJoin('right');

	innerJoin = this.createJoin('inner');

	fullJoin = this.createJoin('full');

	fields<TSelect extends SelectFields>(
		fields: TSelect,
	): Omit<PgSelect<TTable, TSelect, 'partial', TJoinsNotNullable>, 'fields'> {
		this.config.fields = orderSelectedFields(fields);
		this.isPartialSelect = true;
		return this as AnyPgSelect;
	}

	where(where: SQL | undefined): Omit<this, 'where' | `${JoinType}Join`> {
		this.config.where = where;
		return this;
	}

	groupBy(...columns: (AnyPgColumn | SQL)[]): Omit<this, 'where' | `${JoinType}Join`> {
		this.config.groupBy = columns as SQL[];
		return this;
	}

	orderBy(...columns: SQL[]): Omit<this, 'where' | `${JoinType}Join` | 'orderBy'> {
		this.config.orderBy = columns;
		return this;
	}

	limit(limit: number): Omit<this, 'where' | `${JoinType}Join` | 'limit'> {
		this.config.limit = limit;
		return this;
	}

	offset(offset: number): Omit<this, 'where' | `${JoinType}Join` | 'offset'> {
		this.config.offset = offset;
		return this;
	}

	/** @internal */
	getSQL(): SQL {
		return this.dialect.buildSelectQuery(this.config);
	}

	toSQL(): Query {
		return this.dialect.sqlToQuery(this.getSQL());
	}

	private _prepare(name?: string): PreparedQuery<
		PreparedQueryConfig & {
			execute: SelectResult<TResult, TSelectMode, TJoinsNotNullable>[];
		}
	> {
		return this.session.prepareQuery(this.toSQL(), this.config.fields, name);
	}

	prepare(name: string): PreparedQuery<
		PreparedQueryConfig & {
			execute: SelectResult<TResult, TSelectMode, TJoinsNotNullable>[];
		}
	> {
		return this._prepare(name);
	}

	override execute: ReturnType<this['prepare']>['execute'] = (placeholderValues) => {
		return this._prepare().execute(placeholderValues);
	};
}
